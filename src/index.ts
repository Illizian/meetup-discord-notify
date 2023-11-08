import {
  compareAsc,
  format,
  formatDuration,
  intervalToDuration,
  isBefore,
  lastDayOfMonth,
  parse,
} from "date-fns";
import { Event, MeetupEvent } from "./types";

export interface Env {
  ADMIN_TOKEN: string;
  DISCORD_API_TOKEN: string;
  DISCORD_CHANNEL: string;

  MEETUP_GROUPS: KVNamespace;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { searchParams } = new URL(request.url);
    let group = searchParams.get("group");
    let token = searchParams.get("token");

    if (token !== env.ADMIN_TOKEN) {
      return new Response(
        JSON.stringify({ Error: "Authentication Required." }),
        {
          status: 401,
        },
      );
    }

    if (!group) {
      return new Response(
        JSON.stringify({ Error: "`group` is a required field." }),
        {
          status: 403,
        },
      );
    }

    const data = (await env.MEETUP_GROUPS.get("groups")) || "";
    let groups = [
      ...data.split(",").filter(Boolean),
      ...group.split(",").filter(Boolean),
    ];

    await env.MEETUP_GROUPS.put("groups", groups.join(","));

    return new Response(
      `Added ${groups.join(", ")} to store, currently ${
        groups.length
      } groups stored`,
    );
  },

  async scheduled(
    _controller: ScheduledController,
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<void> {
    const data = (await env.MEETUP_GROUPS.get("groups")) || "";
    const groups = data.split(",").filter(Boolean);

    if (!groups.length) {
      return;
    }

    const results = await Promise.all(groups.map((group) => getEvents(group)));
    const embeds = results
      .flat()
      .filter(({ datetime }) => isBefore(datetime, lastDayOfMonth(new Date())))
      .sort((a: Event, b: Event) => compareAsc(a.datetime, b.datetime))
      .map(eventToEmbed);

    if (embeds.length === 0) {
      return;
    }

    await discord(
      env.DISCORD_API_TOKEN,
      env.DISCORD_CHANNEL,
      "Hey @everyone, we just wanted to let you know about some of the community events coming up this month!",
      [],
      embeds,
    );
  },
};

const getEvents = async (group: string, limit: number = 10): Promise<Event[]> =>
  await fetch(
    `https://api.meetup.com/${group}/events?photo-host=public&page=${limit}`,
  )
    .then(async (response: Response) => await response.json<MeetupEvent[]>())
    .then((events): Event[] =>
      events.map(
        (event) =>
          ({
            ...event,
            datetime: parse(
              `${event.local_date} ${event.local_time}`,
              "yyyy-MM-dd kk:mm",
              new Date(),
            ),
            duration: intervalToDuration({
              start: 0,
              end: event.duration,
            }),
          }) as Event,
      ),
    );

const eventToEmbed = (event: Event) => ({
  type: "rich",
  author: {
    name: event.group.name,
    url: `https://meetup.com/${event.group.urlname}`,
  },
  color: 0xbf1c2e,
  title: event.name,
  description: event.description.replace(/(<([^>]+)>)/gi, "").substring(0, 480),
  url: event.link,
  fields: [
    {
      name: "🗓️ When?",
      value: `\`${format(event.datetime, "eeee, do LLLL, kk:mm")}\``,
    },
    {
      name: "📍 Where?",
      value:
        event.eventType === "PHYSICAL"
          ? event.venue
            ? `\`${event.venue?.name}, ${event.venue?.city}\``
            : "`TBC`"
          : "`Online`",
    },
    {
      name: "⏲️ Duration?",
      value: `\`${formatDuration(event.duration)}\``,
    },
  ],
});

const discord = async (
  token: string,
  channel: string,
  content: string,
  components: any[] = [],
  embeds: any[] = [],
): Promise<Response> =>
  await fetch(`https://discord.com/api/v10/channels/${channel}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bot ${token}`,
    },
    body: JSON.stringify({
      channel_id: channel,
      content,
      components,
      embeds,
    }),
  });

import { it, expect } from "vitest";
import { streamParseRss } from "./parser";
it("parses large feed with 25 episodes", async () => {
const xml = `<rss><channel><title>Feed</title>${Array.from({length:25},(_,i)=>`<item><title>${i}</title><enclosure url="https://x.test/a.mp3"/></item>`).join('')}</channel></rss>`;
const r = await streamParseRss(new Response(xml).body!, "https://feed.test/");
expect(r.episodes).toHaveLength(20);
});

it("handles a feed cut off at the episode limit", async () => {
  const prefix = `<rss><channel>${Array.from({length: 20}, (_, i) => `<item><title>${i}</title><enclosure url="https://x.test/a.mp3"/></item>`).join("")}`;
  const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode(prefix)); } });
  const feed = await streamParseRss(stream, "https://feed.test/");
  expect(feed.episodes).toHaveLength(20);
});

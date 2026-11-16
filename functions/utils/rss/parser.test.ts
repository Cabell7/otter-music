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

it("stops reading a feed over 2 MB after its first 20 episodes", async () => {
  let reads = 0;
  const prefix = `<rss><channel>${Array.from({length:20}, (_, i) => `<item><title>${i}</title><enclosure url="https://x.test/a.mp3"/></item>`).join("")}`;
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) { reads++; if (reads === 1) controller.enqueue(encoder.encode(prefix)); else controller.enqueue(new Uint8Array(3 * 1024 * 1024)); },
  }, { highWaterMark: 0 });
  const feed = await streamParseRss(stream, "https://feed.test/");
  expect(feed.episodes).toHaveLength(20);
  expect(reads).toBe(1);
});

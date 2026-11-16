import { describe, it, expect, vi } from "vitest";
vi.mock("./utils/music/netease-api", () => ({
  getPlaylists: vi.fn(async () => ({ data: { playlists: [{ id: 123 }] } })),
  getPlaylistDetail: vi.fn(async () => ({ id: 123, tracks: [] })),
  getRecommendPlaylists: vi.fn(), getToplist: vi.fn(), getAlbum: vi.fn(), getArtist: vi.fn(),
}));
vi.mock("./utils/music/billboard-api", () => ({ BILLBOARD_CHART_SLUGS: ["hot-100"], fetchBillboardChart: vi.fn(async () => [{ rank: 1 }]) }));
import { app } from "./app";
import { signSiteJWT } from "./utils/auth";
import { getPlaylists, getPlaylistDetail } from "./utils/music/netease-api";
const password = "test-password-which-is-long-enough";
const env = { PASSWORD: password } as any;
describe("private metadata", () => {
  it("requires a site session and validates arguments before fetching", async () => {
    expect((await app.request("https://music.test/metadata/netease/playlists", {}, env)).status).toBe(401);
    const cookie = `site=${await signSiteJWT(password)}`;
    const headers = { Cookie: cookie };
    expect((await app.request("https://music.test/metadata/netease/playlist?id=https://example.com", { headers }, env)).status).toBe(400);
    expect((await app.request("https://music.test/metadata/netease/playlists?limit=999", { headers }, env)).status).toBe(400);
    expect(vi.mocked(getPlaylistDetail)).not.toHaveBeenCalled();
    const response = await app.request("https://music.test/metadata/netease/playlists?cat=%E5%8D%8E%E8%AF%AD&limit=20&offset=0", { headers }, env);
    expect(response.status).toBe(200);
    expect((await response.json() as any).data.playlists[0].id).toBe(123);
    expect(getPlaylists).toHaveBeenCalledWith("华语", "hot", 20, 0, "");
    const detail = await app.request("https://music.test/metadata/netease/playlist?id=123", { headers }, env);
    expect((await detail.json() as any).data.tracks).toEqual([]);
    expect((await app.request("https://music.test/metadata/billboard?chart=hot-100", { headers }, env)).status).toBe(200);
  });
  it("limits podcast fetches to fixed sources and rejects redirects", async () => {
    const cookie = `site=${await signSiteJWT(password)}`;
    const headers = { Cookie: cookie };
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response('<rss><channel><title>Feed</title><item><title>Episode</title><enclosure url="https://media.example/ep.mp3"/></item></channel></rss>', {status: 200}));
    expect((await app.request("https://music.test/metadata/podcast?source=https://example.com", {headers}, env)).status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
    const res = await app.request("https://music.test/metadata/podcast?source=default-zx7", {headers}, env);
    expect(res.status).toBe(200);
    expect((await res.json() as any).data.episodes[0].title).toBe("Episode");
    expect(fetchSpy).toHaveBeenCalledWith("https://feed.xyzfm.space/wb39te6k9gqw", expect.objectContaining({redirect: "error"}));
    fetchSpy.mockRestore();
  });

});

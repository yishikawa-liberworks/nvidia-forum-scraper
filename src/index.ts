import { Effect, pipe } from "effect";
import { parseISO } from "date-fns";
import * as fs from "fs/promises";
import * as path from "path";

/**
 * 型定義
 */
type TopicListItem = {
  id: number;
  title: string;
  slug: string;
  created_at: string;
};

type TopicListRes = {
  topic_list: {
    topics: TopicListItem[];
    more_topics_url: string | null;
  };
};

type TopicDetail = {
  post_stream?: {
    posts?: {
      raw?: string;
      cooked?: string;
      created_at: string;
    }[];
  };
};

/**
 * クロール用パラメータ
 */
export interface CrawlParams {
  tag: string;       // "cuda" など
  since: Date;       // 打ち切り日時
  outputDir: string; // CSV出力先ディレクトリ
}

/**
 * 純粋関数: HTMLタグ除去
 */
const stripHtml = (html: string): string => html.replace(/<[^>]+>/g, "");

/**
 * 純粋関数: URL ビルダ等
 */
const buildListUrl = (tag: string, page: number) =>
  `https://forums.developer.nvidia.com/tag/${tag}.json?solved=no&page=${page}`;

const buildDetailUrl = (id: number) =>
  `https://forums.developer.nvidia.com/t/${id}.json`;

const isBefore = (d: Date, limit: Date) => d < limit;

/**
 * fetch + JSON パースを Effect 化
 */
const fetchJson = <T>(url: string): Effect.Effect<T, Error> =>
  Effect.tryPromise({
    try: () =>
      fetch(url)
        .then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json() as Promise<T>;
        }),
    catch: (e) => (e instanceof Error ? e : new Error(String(e)))
  });

/**
 * CSVエスケープ
 */
const escapeCsv = (str: string): string => {
  if (str.includes(",") || str.includes("\n") || str.includes('"')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
};

/**
 * トピック1件をCSVに保存
 */
const saveTopic = (
  params: CrawlParams,
  listing: TopicListItem,
  detail: TopicDetail
): Effect.Effect<void, Error> =>
  pipe(
    Effect.sync(() => {
      const firstPost = detail.post_stream?.posts?.[0];
      // HTML は `cooked`、無ければ markdown の `raw`
      const html = firstPost?.cooked ?? firstPost?.raw ?? "";
      const cleanBody = stripHtml(html);
      return { listing, cleanBody };
    }),
    Effect.flatMap(({ listing, cleanBody }) =>
      Effect.tryPromise({
        try: async () => {
          const csvLine = [
            listing.id,
            escapeCsv(listing.title),
            escapeCsv(cleanBody),
            listing.created_at,
            params.tag
          ].join(",") + "\n";

          const outputFile = path.join(params.outputDir, `${params.tag}_topics.csv`);
          await fs.appendFile(outputFile, csvLine, "utf-8");
        },
        catch: (e) => (e instanceof Error ? e : new Error(String(e)))
      })
    )
  );

/**
 * CSVヘッダーを作成
 */
const createCsvHeader = (params: CrawlParams): Effect.Effect<void, Error> =>
  Effect.tryPromise({
    try: async () => {
      const header = "id,title,body,created_at,tag\n";
      const outputFile = path.join(params.outputDir, `${params.tag}_topics.csv`);
      await fs.writeFile(outputFile, header, "utf-8");
    },
    catch: (e) => (e instanceof Error ? e : new Error(String(e)))
  });

/**
 * 再帰的にページをクロール
 */
const crawlPage = (
  params: CrawlParams,
  page = 1
): Effect.Effect<void, Error> =>
  pipe(
    fetchJson<TopicListRes>(buildListUrl(params.tag, page)),
    Effect.flatMap(({ topic_list: { topics, more_topics_url } }) =>
      pipe(
        // 各トピックを逐次処理
        Effect.forEach(topics, (t: TopicListItem) =>
          Effect.suspend(() => {
            const createdDate = parseISO(t.created_at);
            if (isBefore(createdDate, params.since)) {
              // 打ち切り日時以前ならスキップ & 終了
              return Effect.succeed(void 0);
            }
            return pipe(
              fetchJson<TopicDetail>(buildDetailUrl(t.id)),
              Effect.flatMap((detail) => saveTopic(params, t, detail))
            );
          })
        ),
        // 次ページへ or 終了
        Effect.flatMap(() =>
          !more_topics_url ||
          topics.some((t: TopicListItem) => isBefore(parseISO(t.created_at), params.since))
            ? Effect.succeed(void 0)
            : crawlPage(params, page + 1)
        )
      )
    )
  );

/**
 * エクスポート
 */
export const crawlNvidia = (p: CrawlParams): Effect.Effect<void, Error> =>
  pipe(
    createCsvHeader(p),
    Effect.flatMap(() => crawlPage(p)),
    Effect.tapError((e) => Effect.sync(() => console.error(e)))
  );
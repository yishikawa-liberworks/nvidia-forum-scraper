import { Effect } from "effect";
import { crawlNvidia } from "./index";
import * as path from "path";

const showHelp = () => {
  console.log(`
使用方法:
  npm start -- [オプション]

オプション:
  --tag <タグ名>       検索するタグ（例: cuda, pytorch）
  --since <日付>       この日付以降のトピックを取得（例: 2024-01-01）
  --output <ディレクトリ> 出力先ディレクトリ（デフォルト: ./output）

例:
  npm start -- --tag cuda --since 2024-01-01
  npm start -- --tag pytorch --since 2023-12-01 --output ./pytorch_data
`);
  process.exit(1);
};

const parseArgs = () => {
  const args = process.argv.slice(2);
  const params: { [key: string]: string } = {};

  for (let i = 0; i < args.length; i += 2) {
    const key = args[i];
    const value = args[i + 1];

    if (!value || value.startsWith("--")) {
      console.error(`エラー: ${key} の値が指定されていません`);
      showHelp();
    }

    switch (key) {
      case "--tag":
      case "--since":
      case "--output":
        params[key.slice(2)] = value;
        break;
      default:
        console.error(`エラー: 不明なオプション ${key}`);
        showHelp();
    }
  }

  if (!params.tag || !params.since) {
    console.error("エラー: --tag と --since は必須です");
    showHelp();
  }

  // 日付の検証
  const sinceDate = new Date(params.since);
  if (isNaN(sinceDate.getTime())) {
    console.error("エラー: 無効な日付形式です");
    showHelp();
  }

  return {
    tag: params.tag,
    since: sinceDate,
    outputDir: path.resolve(process.cwd(), params.output || "output")
  };
};

const main = () => {
  const params = parseArgs();

  // 出力ディレクトリを作成
  import("fs/promises").then(({ mkdir }) => 
    mkdir(params.outputDir, { recursive: true })
      .then(() => {
        console.log(`クロール開始:
- タグ: ${params.tag}
- 取得開始日: ${params.since.toISOString().split("T")[0]}
- 出力先: ${params.outputDir}
`);

        Effect.runPromise(crawlNvidia(params))
          .then(() => console.log("完了しました"))
          .catch(console.error);
      })
  );
};

main();
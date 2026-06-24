# データ収集スケジューリングの実態と方針

## 実態（2026-06-18 実測）

`collect.yml` は `*/15`（15分毎）を宣言しているが、GitHub Actions の `schedule` は
高負荷時に**間引かれる**。`gh run list` の実績では schedule 起動の間隔が **約1.9〜5.1時間**
（例: 02:05→07:10 で5時間空く）に達していた。つまり「リアルタイム」を謳うダッシュボードの
更新が数時間遅れる状態だった。これは cron 式の調整では根本解決しない（GitHub 側の仕様）。

## 現在の緩和策（リポジトリ内・無料）

1. **オフセット分の cron**：`7,22,37,52 * * * *`。`:00/:15/:30/:45` の最混雑スロットを避け、
   間引きの確率を下げる。
2. **重い層の分離**：気温/水温（`airtemp`/`sst`）は変化が遅く収集も重い（各5分超）。
   高頻度の `collect.yml` から `collect-slow.yml`（3時間毎）へ分離し、速い層
   （地震/航空/船舶/ニュース）のコミットを遅らせない。
3. **直列化**：両ワークフローは `concurrency.group: collect` を共有し、リポジトリ全体で
   直列実行 → 同時 push 競合を防ぐ。コミット前に `git pull --rebase` も実施。
4. **鮮度の正直化**：UI は各スナップショットの `updated` を直読して全層の経過時間を表示する
   （古い層は「N時間前/N日前」と明示）。間引きで古くなっても利用者に見える。

## 恒久対策（任意・要・外部サービス）

15分間隔を確実に守りたい場合、GitHub Actions の `schedule` に依存せず、**外部スケジューラから
`workflow_dispatch` を叩く**のが定石。

1. fine-grained PAT（`actions:write` のみ・`sg55555/orbis` スコープ）を発行。
2. cron-job.org / UptimeRobot 等の常時稼働サービスに 15分毎ジョブを作成し、以下を叩く：
   ```
   POST https://api.github.com/repos/sg55555/orbis/actions/workflows/collect.yml/dispatches
   Authorization: Bearer <PAT>
   Body: {"ref":"main"}
   ```
3. これにより schedule の間引きを受けず、外部サービスの精度で起動できる。

> 注: 外部サービスのアカウント作成と PAT 管理が必要なため、導入判断はオーナーに委ねる。
> 上記が無くても、現在の緩和策（オフセット＋分離＋鮮度の正直化）で実害は大きく軽減される。

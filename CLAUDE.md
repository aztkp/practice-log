# Practice Log

## 重要なルール

- **プッシュ前に必ずリモートをマージする**: ユーザーがアプリで学習中にdata.jsonを更新している可能性があるため、必ず `git pull origin main` してからpushすること
- **変更後は必ずリモートにプッシュする**: このアプリはGitHub Pagesでホストされているため、data.jsonやdocs/内のファイルを変更したら必ず`git push`すること
- コミットとプッシュはセットで行う
- **正しいワークフロー**: `git pull origin main && git add ... && git commit ... && git push origin main`

## 構成

- `docs/` - GitHub Pagesで公開されるファイル（HTML, CSS, JS）
- `data.json` - アプリのデータ（教材、フレーズ、記録など）

## カテゴリ

- Piano: ピアノ練習トラッキング
- Guitar: ギター練習トラッキング
- English: 英会話Quick Response

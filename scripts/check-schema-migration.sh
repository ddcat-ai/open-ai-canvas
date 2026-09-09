#!/bin/sh
# check-schema-migration.sh —— 数据库迁移覆盖卡口（方案 B）
#
# 用途
#   拦截「模型层新增了持久化字段或新表，但 schemaMigrations 没有配套新条目」这类
#   静默故障。背景：fork 曾因上游 v1.2.8.rc1 新增 model_channels.public_alias /
#   sort_order 而漏配迁移，导致存量生产库缺列、SystemChannels 等路径报错。
#   根因是 schema.go 的 AutoMigrate(Models()...) 位于 migrateSchemaV1 内部，
#   存量库 1 号迁移已登记，永远不会重跑 V1，新列/新表不会落地。
#
# 判定口径（重要）
#   新增行与删除行按「(文件, 字段名, 字段类型)」配对：
#     - 配得上 → 判为「重排」，不算新增（gofmt 对齐、IDE 重排、字段位置移动）
#     - 配不上 → 判为「新增持久化字段」
#   新表同理按「(文件, 类型名)」配对。
#   之所以把类型也纳入配对键：`Foo string` → `Foo int` 不会被配掉，
#   类型变更本来就该走迁移。
#
# 盲区（务必知悉，本脚本不是完整防线）
#   1. 只能卡「忘了加迁移」，卡不住「加了迁移但列写错 / 迁移内容不正确」。
#   2. 只检测「带 gorm: tag 的字段」。GORM 对未打 tag 的导出字段同样会建列，
#      本脚本不检测这一类，以免把辅助结构体误判为数据表；新增表由
#      「type X struct」规则兜底。
#   3. 「type X struct」规则会把 model 包下新增的非表辅助结构体也算作新表，
#      属预期噪声，用豁免机制放行即可。
#   4. 基于行匹配而非 AST：以 // 开头的行会被当作注释跳过，但块注释
#      /* ... */ 内部若出现带 gorm: tag 的行，仍可能被误判为新增字段。
#      目前 model 包没有这种写法；若后续出现，用豁免机制放行。
#   5. 重排配对只看「(文件, 字段名, 类型)」，不看字段属于哪个 struct。
#      因此「同一文件内把 SortOrder 从 A struct 搬到 B struct」会被判为重排
#      而漏报。概率极低，但确实是残留盲区。
#   6. 配对是集合匹配、不是 1:1 消费：同一文件内若存在多个同名字段同类型，
#      删除一个、新增一个仍会被判为重排。同 5，属残留盲区。
#   7. 不替代人工复核、不替代变异测试、不替代真实存量库升级演练。
#
# 用法
#   sh scripts/check-schema-migration.sh [<base-ref>]
#   base-ref 默认 origin/main；PR 场景建议显式传 PR 的 base sha。
#   注意：本脚本依赖 base 与 HEAD 的完整历史，CI 里 checkout 需 fetch-depth: 0。
#
# 豁免
#   以下任一处出现「NO_MIGRATION_NEEDED:<非空理由>」即放行（打印警告并 exit 0），
#   留痕可追溯：
#     a) 比对范围内的 diff 文本
#     b) 比对范围内的提交信息（git log --format=%B <base>...HEAD）
#     c) 环境变量 NO_MIGRATION_NEEDED
#
# 退出码
#   0 = 通过或已豁免   1 = 违规（有新字段/新表但无新迁移）   2 = 用法或环境错误

set -u

BASE="${1:-origin/main}"
MODEL_DIR="backend/internal/model"
MIGRATIONS_FILE="backend/internal/database/migrations.go"
WAIVER_TOKEN="NO_MIGRATION_NEEDED"

die_usage() {
	echo "用法: sh scripts/check-schema-migration.sh [<base-ref>]（默认 origin/main）" >&2
	exit 2
}

if [ "$#" -gt 1 ]; then
	die_usage
fi

if ! git rev-parse --git-dir >/dev/null 2>&1; then
	echo "错误：当前目录不是 git 仓库。" >&2
	exit 2
fi

if ! git rev-parse --verify --quiet "$BASE^{commit}" >/dev/null 2>&1; then
	echo "错误：基线 ref 不可解析：$BASE" >&2
	echo "提示：CI 里请传入 PR base sha，并确保 checkout 使用 fetch-depth: 0。" >&2
	exit 2
fi

# 三方比较：base 与 HEAD 的合并基线 → HEAD，符合 PR 语义。
DIFF=$(git diff -U0 "$BASE"...HEAD -- "$MODEL_DIR" "$MIGRATIONS_FILE" 2>/dev/null)

if [ -z "$DIFF" ]; then
	# 非豁免路径下也可能确实没有相关改动，此时属于正常通过。
	NO_DIFF=1
else
	NO_DIFF=0
fi

# 把 -U0 diff 还原成「路径:行号:内容」的增量行流；同时去掉可能的 CR。
# 新增行（+）用于判定新增；删除行（-）用于与新增行配对识别重排。
ADDED=$(printf '%s\n' "$DIFF" | awk '
	function trimcr(s) { sub(/\r$/, "", s); return s }
	/^\+\+\+ / { file = substr($0, 5); sub(/^b\//, "", file); file = trimcr(file); next }
	/^@@/ {
		if (match($0, /\+[0-9]+/)) {
			line = substr($0, RSTART + 1, RLENGTH - 1) + 0
		}
		next
	}
	/^\+/ {
		content = trimcr(substr($0, 2))
		if (file != "") printf "%s:%d:%s\n", file, line, content
		line++
		next
	}
')

REMOVED=$(printf '%s\n' "$DIFF" | awk '
	function trimcr(s) { sub(/\r$/, "", s); return s }
	/^\+\+\+ / { file = substr($0, 5); sub(/^b\//, "", file); file = trimcr(file); next }
	/^--- / { next }
	/^@@/ { next }
	/^-/ {
		content = trimcr(substr($0, 2))
		if (file != "") printf "%s:%s\n", file, content
		next
	}
')

# 分类：FIELD=新增持久化字段 / TYPE=新增结构体(新表) / MIG=新增迁移注册
# 命中删除行配对者降级为 REORDER（重排，不算新增）。
CLASSIFIED=$(printf '%s\n' "$ADDED" | awk -v modeldir="$MODEL_DIR" -v migfile="$MIGRATIONS_FILE" -v removed="$REMOVED" '
	function trim(s) { sub(/^[ \t]+/, "", s); sub(/[ \t]+$/, "", s); return s }
	# 从形如 "  ID   string `json:\"id\" gorm:\"...\"`" 的字段行取出 (字段名, 字段类型)
	function declkey(content,   decl, a, n) {
		decl = content
		sub(/`.*/, "", decl)
		sub(/^[ \t]+/, "", decl)
		sub(/[ \t]+$/, "", decl)
		n = split(decl, a, /[ \t]+/)
		if (n < 2) return ""
		return a[1] "|" a[2]
	}
	function removedkey(content,   tc, tag, a, n) {
		if (content ~ /gorm:"/) {
			tag = content
			sub(/.*gorm:"/, "", tag)
			sub(/".*/, "", tag)
			if (tag ~ /^-/) return ""
			return "FIELD|" declkey(content)
		}
		tc = trim(content)
		if (tc ~ /^\/\//) return ""
		if (tc ~ /^type[ \t]+[A-Za-z_][A-Za-z0-9_]*[ \t]+struct([ \t]*\{)?$/) {
			n = split(tc, a, /[ \t]+/)
			return "TYPE|" a[2]
		}
		return ""
	}
	function isreorder(file, key) {
		return index(removed_index, "\n" file "|" key "\n") > 0
	}
	BEGIN {
		# 建立「文件|分类键」索引；两端补换行，保证整键匹配而非子串匹配。
		removed_index = "\n"
		n = split(removed, lines, "\n")
		for (i = 1; i <= n; i++) {
			if (lines[i] == "") continue
			p = index(lines[i], ":")
			if (p == 0) continue
			rf = substr(lines[i], 1, p - 1)
			rc = substr(lines[i], p + 1)
			rk = removedkey(rc)
			if (rk == "") continue
			removed_index = removed_index rf "|" rk "\n"
		}
	}
	{
		n = index($0, ":")
		p = substr($0, 1, n - 1)
		rest = substr($0, n + 1)
		m = index(rest, ":")
		lineno = substr(rest, 1, m - 1)
		content = substr(rest, m + 1)
		tc = trim(content)

		if (p == migfile) {
			if (content ~ /\{version:[ \t]*[0-9]+,/) printf "MIG\t%s:%s\t%s\n", p, lineno, tc
			next
		}
		if (p ~ ("^" modeldir "/.*\\.go$")) {
			# 纯注释行不参与判定
			if (tc ~ /^\/\//) next
			# 新增结构体（潜在新表）
			if (tc ~ /^type[ \t]+[A-Za-z_][A-Za-z0-9_]*[ \t]+struct([ \t]*\{)?$/) {
				split(tc, a, /[ \t]+/)
				if (isreorder(p, "TYPE|" a[2])) {
					printf "REORDER\t%s:%s\t%s\n", p, lineno, tc
					next
				}
				printf "TYPE\t%s:%s\t%s\n", p, lineno, tc
				next
			}
			# 带 gorm tag 的字段
			if (content ~ /gorm:"/) {
				tag = content
				sub(/.*gorm:"/, "", tag)
				sub(/".*/, "", tag)
				# gorm:"-"、"-:migration"、"-:all" 等以 '-' 开头者不落地为列
				if (tag ~ /^-/) next
				dk = declkey(content)
				if (dk != "" && isreorder(p, "FIELD|" dk)) {
					printf "REORDER\t%s:%s\t%s\n", p, lineno, tc
					next
				}
				printf "FIELD\t%s:%s\t%s\n", p, lineno, tc
			}
		}
	}
')

FIELD_HITS=$(printf '%s\n' "$CLASSIFIED" | grep '^FIELD' | cut -f2-)
TYPE_HITS=$(printf '%s\n' "$CLASSIFIED" | grep '^TYPE' | cut -f2-)
MIG_HITS=$(printf '%s\n' "$CLASSIFIED" | grep '^MIG' | cut -f2-)
REORDER_HITS=$(printf '%s\n' "$CLASSIFIED" | grep '^REORDER' | cut -f2-)

FIELD_COUNT=$(printf '%s\n' "$FIELD_HITS" | grep -c . )
TYPE_COUNT=$(printf '%s\n' "$TYPE_HITS" | grep -c . )
MIG_COUNT=$(printf '%s\n' "$MIG_HITS" | grep -c . )
REORDER_COUNT=$(printf '%s\n' "$REORDER_HITS" | grep -c . )

echo "== 迁移覆盖卡口 =="
echo "基线(base): $BASE"
echo "比较范围:   $BASE...HEAD  （限定 $MODEL_DIR 与 $MIGRATIONS_FILE）"
if [ "$NO_DIFF" -eq 1 ]; then
	echo "改动:       无（以上路径无差异）"
fi
echo "新增持久化字段: $FIELD_COUNT"
echo "新增结构体(表): $TYPE_COUNT"
echo "新增迁移注册:   $MIG_COUNT"
echo "重排(已忽略):   $REORDER_COUNT"

# 豁免：diff 文本、比对范围内的提交信息、或环境变量中出现 NO_MIGRATION_NEEDED:<非空理由>
WAIVER=$(printf '%s\n' "$DIFF" | grep -E "${WAIVER_TOKEN}:[ \t]*[^ \t]+" | head -n 1)
if [ -z "$WAIVER" ]; then
	LOGTEXT=$(git log --format=%B "$BASE"...HEAD 2>/dev/null)
	if [ -n "$LOGTEXT" ]; then
		WAIVER=$(printf '%s\n' "$LOGTEXT" | grep -E "${WAIVER_TOKEN}:[ \t]*[^ \t]+" | head -n 1)
	fi
fi
if [ -z "$WAIVER" ] && [ -n "${NO_MIGRATION_NEEDED:-}" ]; then
	WAIVER="env: ${NO_MIGRATION_NEEDED}"
fi

if [ -n "$WAIVER" ]; then
	echo ""
	echo "⚠ 已豁免（留痕）：$WAIVER"
	echo "结果: PASS（豁免）"
	exit 0
fi

if [ "$FIELD_COUNT" -eq 0 ] && [ "$TYPE_COUNT" -eq 0 ]; then
	echo ""
	echo "结果: PASS（无新增持久化字段/新表）"
	exit 0
fi

if [ "$MIG_COUNT" -gt 0 ]; then
	echo ""
	echo "结果: PASS（已配套新增迁移）"
	exit 0
fi

echo ""
echo "❌ 结果: FAIL —— 模型层有新增持久化字段/新表，但 schemaMigrations 没有新增条目。"
echo "   存量库不会自动补齐这些列/表：AutoMigrate(Models()...) 在 migrateSchemaV1 内，"
echo "   已登记的 1 号迁移会被跳过。"
echo ""
echo "命中明细："
printf '%s\n' "$FIELD_HITS" | grep . | sed 's/\t/ | /g' | sed 's/^/   [字段] /'
printf '%s\n' "$TYPE_HITS" | grep . | sed 's/\t/ | /g' | sed 's/^/   [新表] /'
echo ""
echo "处理办法（二选一）："
echo "  1. 在 backend/internal/database/migrations.go 的 schemaMigrations 追加新迁移，"
	echo "     并同步 CurrentSchemaVersion（参考 11=channel_presentation 的做法）。"
	echo "  2. 若确实不需要迁移，请显式豁免：在提交信息/PR 描述或环境变量中写上"
	echo "     ${WAIVER_TOKEN}:<理由>，例如 ${WAIVER_TOKEN}:仅新增辅助结构体，非数据表"
	exit 1

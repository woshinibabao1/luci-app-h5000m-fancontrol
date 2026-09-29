#!/bin/sh
# 风扇控制器的安全不变量。
#
# 背景：2.0.0 曾把整个 CPU thermal zone 切到 user_space —— 那等于关掉内核自己的
# CPU 降频与过热保护。2.1.0 起改为「只写风扇 PWM、不动 governor」，并把旧版本
# 留下的 policy 恢复回去。这里钉的就是这条不变量。
#
# ★ 断言只针对**行为**（写哪个文件、在哪些位置调恢复函数），不针对注释文字：
#   钉注释的守卫会在改说明时误报，而且证明不了任何东西（原第 12 行的
#   `grep -q 'kernel must'` 就是这种，已移除）。
set -eu

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
CONTROLLER="${ROOT}/root/usr/sbin/h5000m-fancontrol"

# ① 不得把 user_space 写进任何 thermal policy 节点
if grep -Eq 'echo[[:space:]]+user_space[[:space:]]*>.*policy' "${CONTROLLER}"; then
	echo 'The fan controller must not replace the CPU thermal governor.' >&2
	exit 1
fi

# ② 恢复路径必须在场。只数「出现过几次」说明不了位置，所以分别钉两个调用点：
#    进程退出时（EXIT trap）、以及切到「仅内核保护」时的分支。
grep -qE "trap '[^']*release_thermal_control' EXIT" "${CONTROLLER}" || {
	echo 'exit path no longer restores the legacy thermal policy.' >&2
	exit 1
}
grep -qE '^[[:space:]]*release_thermal_control$' "${CONTROLLER}" || {
	echo 'kernel/disabled branch no longer restores the legacy thermal policy.' >&2
	exit 1
}

# ③ governor 一旦被接管就必须能被还原：恢复函数要写回 policy 节点
grep -q 'echo "\$policy" > "\$zone/policy"' "${CONTROLLER}" || {
	echo 'release_thermal_control no longer writes the saved policy back.' >&2
	exit 1
}

echo 'thermal policy safety tests passed'

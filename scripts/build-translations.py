# -*- coding: utf-8 -*-
"""按代码里实际出现的 _() 文案重写 zh_Hans 翻译表。

旧文件里还留着 67 条上一个版本 UI 的文案（当前代码已不再引用），一并清掉，
避免"翻译了但永远不会显示"的僵尸条目。
"""
import io
import re

SRC = 'htdocs/luci-static/resources/view/h5000m/fancontrol.js'
PO = 'po/zh_Hans/h5000m-fancontrol.po'

ZH = {
    "%s (%s)": "%s（%s）",
    "%s / 255": "%s / 255",
    "%s s": "%s 秒",
    "%s s ago": "%s 秒前",
    "%s °C": "%s °C",
    "%s · kernel floor": "%s · 内核下限",
    "5G modem": "5G 模组",
    "A short boost helps a stopped fan start reliably. Set 0 to disable.":
        "短暂助推有助于停转的风扇可靠启动，填 0 关闭。",
    "Applied": "实际",
    "Automatic": "自动",
    "Balanced": "均衡",
    "CPU only": "仅 CPU",
    "Checking…": "检测中…",
    "Comma-separated temperature:percent points. The controller interpolates between them.":
        "逗号分隔的「温度:百分比」点，控制器在点之间线性插值。",
    "Control": "控温",
    "Control input": "控温输入",
    "Control interval": "控制间隔",
    "Control temperature": "控温温度源",
    "Cooling management": "散热管理",
    "Cooling overview": "散热总览",
    "Cooling policy": "散热策略",
    "Cooling policy applied successfully.": "散热策略已生效。",
    "Cooling profile": "散热曲线",
    "Curve failsafe": "曲线异常，已进入安全模式",
    "Custom": "自定义",
    "Custom curve": "自定义曲线",
    "Do not read": "不读取",
    "Enable enhanced controller": "启用增强控制",
    "Ethernet PHY": "以太网 PHY",
    "Failed to apply cooling policy:": "策略应用失败：",
    "Failsafe cooling": "安全模式散热",
    "Fan curve": "风扇曲线",
    "Fan manager": "插件接管",
    "Fan output": "风扇输出",
    "Fan output follows the hottest sensor through a temperature curve. Kernel protection stays in charge of throttling and emergency cooling.":
        "风扇输出跟随最热的传感器沿温度曲线调节；内核保护始终负责降频与临界过热保护。",
    "Following curve": "按曲线调节",
    "Holding before spin-down": "降速等待中",
    "Hottest available considers CPU, Wi-Fi, Ethernet PHY and the 5G modem.":
        "「最热可用」会同时考虑 CPU、Wi-Fi、以太网 PHY 与 5G 模组。",
    "Hottest available sensor": "最热的可用传感器",
    "Hottest channel: %s": "最热通道：%s",
    "Hottest one drives the fan": "最热的一路驱动风扇",
    "Kernel": "内核",
    "Kernel control": "内核控制",
    "Kernel only": "仅内核",
    "Kernel protection only": "仅内核保护",
    "Kernel safety floor": "内核安全下限",
    "Kernel thermal protection is always retained; the effective output may be raised above the request when the kernel needs more cooling.":
        "内核热保护始终保留；当内核需要更多散热时，实际输出可能高于请求值。",
    "Last known value (driver busy)": "上次读数（驱动忙）",
    "MT7992 · %s": "MT7992 · %s",
    "Manual": "手动",
    "Manual PWM output": "手动 PWM 输出",
    "Manual setting": "手动设定",
    "No valid sensor": "无有效传感器",
    "Not detected": "未检测到",
    "Not exposed by this radio driver": "该无线驱动未暴露温度",
    "Operating mode": "运行模式",
    "Performance": "性能",
    "Pick a profile or a fixed output. Safety limits stay active in every mode.":
        "选择曲线或固定输出。任何模式下安全限制都生效。",
    "Policy": "策略",
    "Prevents repeated speed changes around a curve point.": "避免在曲线拐点附近反复调速。",
    "Query the radio driver": "向无线驱动查询",
    "Quiet": "静音",
    "Radio driver statistics": "无线驱动统计",
    "Raw PWM": "PWM 原始值",
    "Requested": "请求",
    "Requires MT5700 Console": "需要 MT5700 Console",
    "Response & safety": "响应与安全",
    "Running normally": "运行正常",
    "Seconds between control decisions. The dashboard refreshes independently.":
        "两次控制决策之间的秒数；页面刷新是独立的。",
    "Seconds between radio-driver queries. The dashboard refresh does not query the driver.":
        "两次向无线驱动查询的间隔秒数；页面刷新不会触发查询。",
    "Sensor failsafe": "传感器异常，已进入安全模式",
    "Shared with kernel": "内核与插件共用",
    "Speed-down delay": "降速延迟",
    "Startup boost PWM": "启动助推 PWM",
    "Startup boost duration": "启动助推时长",
    "Status delayed": "状态延迟",
    "Temperature hysteresis": "温度滞回",
    "Temperature sensors": "温度传感器",
    "Temperatures must increase from 0–150 °C and percentages must be 0–100.":
        "温度须在 0–150 °C 内递增，百分比须在 0–100 之间。",
    "The MT7992 exposes its chip temperature only through private driver statistics, so it is polled at a throttled rate and cached.":
        "MT7992 只在私有驱动统计里暴露芯片温度，因此按节流间隔查询并缓存。",
    "The fan manager owns the fan policy. Kernel CPU throttling and critical over-temperature protection stay active.":
        "插件独占风扇策略；内核的 CPU 降频与临界过热保护仍然生效。",
    "The kernel safety floor may raise the effective output above this value.":
        "内核安全下限可能把实际输出抬到该值之上。",
    "Thermal owner": "热控归属",
    "Use comma-separated temperature:percent points, for example 35:0,45:50,70:80,90:100.":
        "请使用逗号分隔的「温度:百分比」，例如 35:0,45:50,70:80,90:100。",
    "Via MT5700 Console": "经 MT5700 Console",
    "Wait this many seconds before lowering output; temperature increases apply immediately.":
        "降速前等待的秒数；温度上升会立即生效。",
    "When disabled, the fan follows the kernel thermal protection level only.":
        "关闭后风扇只跟随内核热保护档位。",
    "Wi-Fi poll interval": "Wi-Fi 查询间隔",
    "Wi-Fi reading is %s s old": "Wi-Fi 读数为 %s 秒前",
    "Wi-Fi temperature": "Wi-Fi 温度",
    "hwmon node": "hwmon 节点",
    "thermal zone": "thermal zone",
}


def main():
    src = io.open(SRC, encoding='utf-8').read()
    ids = []
    for m in re.finditer(r"_\('((?:[^'\\]|\\.)*)'\)", src):
        text = m.group(1).replace("\\'", "'")
        if text not in ids:
            ids.append(text)
    ids.sort()

    missing = [x for x in ids if x not in ZH]
    if missing:
        raise SystemExit('missing translations: %r' % missing[:5])

    out = ['msgid ""', 'msgstr "Content-Type: text/plain; charset=UTF-8\\n"', '']
    for text in ids:
        out.append('msgid "%s"' % text.replace('"', '\\"'))
        out.append('msgstr "%s"' % ZH[text].replace('"', '\\"'))
        out.append('')
    io.open(PO, 'w', encoding='utf-8', newline='\n').write('\n'.join(out))
    print('wrote %d entries' % len(ids))


if __name__ == '__main__':
    main()

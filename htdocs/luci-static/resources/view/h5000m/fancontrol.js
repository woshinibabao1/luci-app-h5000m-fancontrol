'use strict';
'require view';
'require form';
'require fs';
'require poll';
'require ui';

/*
 * H5000M 风扇控制面板。
 *
 * 数据全部来自 /usr/sbin/h5000m-fancontrol-status（key=value 文本），页面只做呈现，
 * 不自己读 sysfs、不自己发 AT —— 后者会和守护进程抢串口。
 *
 * 三条取数语义固定下来，别再退回旧写法：
 *   ① 温度空串 = 读不到，不是 0℃。卡片必须显示「未检测到」，不能画成 0。
 *   ② WiFi 温度来自私有驱动的 iwpriv 统计（wifi_source=iwpriv|cache|stale|hwmon），
 *      本机型没有 wifi 的 hwmon/thermal 节点，所以 sysfs 一条路走不通。
 *   ③ 5G 模组温度经 ubus 向 MT5700 Console 取（见 controller 脚本），页面上标出来源，
 *      否则读不到时用户不知道是模组没响应还是插件没装。
 *
 * 样式自带命名空间 .h5f 并显式设色：宿主主题（Argon）会把 body 颜色、select 背景、
 * .btn 边框按 !important 钉死，靠继承会糊。标题一律用 div，不用 h1~h6（Argon 给
 * 它们加了 font-weight:normal !important 和卡片背景）。
 */
return view.extend({
	load: function() {
		return this.fetchStatus();
	},

	fetchStatus: function() {
		return fs.exec('/usr/sbin/h5000m-fancontrol-status').then(L.bind(function(res) {
			return this.parseStatus(res.stdout || '');
		}, this)).catch(function() {
			return {};
		});
	},

	parseStatus: function(text) {
		var data = {};
		text.trim().split(/\n/).forEach(function(line) {
			var pos = line.indexOf('=');
			if (pos > -1)
				data[line.substring(0, pos)] = line.substring(pos + 1);
		});
		return data;
	},

	toNum: function(value, fallback) {
		var n = parseInt(value, 10);
		return isNaN(n) ? fallback : n;
	},

	clamp: function(value, min, max) {
		return Math.max(min, Math.min(max, value));
	},

	has: function(value) {
		return value !== undefined && value !== null && value !== '';
	},

	setText: function(id, value) {
		var node = document.getElementById(id);
		if (node && node.textContent !== value)
			node.textContent = value;
	},

	formatTemp: function(value) {
		return this.has(value) ? _('%s °C').format(value) : _('Not detected');
	},

	pct: function(pwm) {
		var n = this.toNum(pwm, NaN);
		return isNaN(n) ? NaN : Math.round(this.clamp(n, 0, 255) * 100 / 255);
	},

	modeName: function(mode) {
		if (mode === 'manual') return _('Manual');
		if (mode === 'kernel') return _('Kernel only');
		return _('Automatic');
	},

	profileName: function(profile) {
		if (profile === 'silent') return _('Quiet');
		if (profile === 'performance') return _('Performance');
		if (profile === 'custom') return _('Custom');
		return _('Balanced');
	},

	reasonName: function(reason) {
		var kernelFloor = (reason || '').indexOf('+kernel-floor') > -1;
		var base = (reason || '').replace('+kernel-floor', '');
		var text;
		if (base === 'auto-down-delay') text = _('Holding before spin-down');
		else if (base === 'auto') text = _('Following curve');
		else if (base === 'manual') text = _('Manual setting');
		else if (base === 'kernel') text = _('Kernel control');
		else if (base === 'sensor-failsafe') text = _('Sensor failsafe');
		else if (base === 'curve-failsafe') text = _('Curve failsafe');
		else text = base || '—';
		return kernelFloor ? _('%s · kernel floor').format(text) : text;
	},

	/* 来源直接说人话：hwmon 是标准节点；vendor 是 MTK 私有驱动的 iwpriv 统计
	   （这台机器唯一能拿到芯片温度的途径）；两者都没有就别装成 0℃。 */
	wifiSourceName: function(data) {
		if (data.wifi_source === 'hwmon') return _('hwmon node');
		if (data.wifi_source === 'vendor') return data.wifi1_label || _('Radio driver statistics');
		return _('Not exposed by this radio driver');
	},

	/* ---------------------------------------------------------------- 样式 */

	styleNode: function() {
		return E('style', {}, [
			'.h5f{--h5-fg:#16211d;--h5-fg2:#586862;--h5-fg3:#8b9a95;--h5-card:#fff;--h5-line:rgba(16,40,34,.11);',
			'--h5-track:rgba(16,40,34,.08);--h5-accent:#0f9d76;--h5-accent2:#12b489;--h5-soft:rgba(15,157,118,.10);',
			'--h5-warn:#c9821f;--h5-bad:#cf4747;--h5-blue:#3b7dd8;--h5-shadow:0 1px 2px rgba(16,40,34,.04),0 8px 24px -18px rgba(16,40,34,.35);',
			'color:var(--h5-fg);font-size:14px;line-height:1.5;max-width:1180px}',
			'@media (prefers-color-scheme: dark){.h5f{--h5-fg:#e9efec;--h5-fg2:#a9b7b2;--h5-fg3:#7d8c87;--h5-card:#1a2220;',
			'--h5-line:rgba(255,255,255,.10);--h5-track:rgba(255,255,255,.09);--h5-accent:#2ec196;--h5-accent2:#3ad3a5;',
			'--h5-soft:rgba(46,193,150,.10);--h5-warn:#e0a444;--h5-bad:#e26a6a;--h5-blue:#6aa5ee;',
			'--h5-shadow:0 1px 2px rgba(0,0,0,.3),0 10px 28px -20px rgba(0,0,0,.9)}}',

			'.h5f *{box-sizing:border-box}',
			'.h5f-head{display:flex;align-items:flex-start;justify-content:space-between;gap:18px;margin:2px 0 18px}',
			'.h5f-title{font-size:21px;font-weight:650;letter-spacing:-.2px;color:var(--h5-fg);margin:0 0 5px}',
			'.h5f-sub{font-size:12.5px;color:var(--h5-fg2);margin:0;max-width:62ch}',
			'.h5f-pill{display:inline-flex;align-items:center;gap:7px;height:30px;padding:0 13px;border-radius:999px;',
			'font-size:12.5px;font-weight:600;white-space:nowrap;background:var(--h5-soft);color:var(--h5-accent);',
			'border:1px solid transparent}',
			'.h5f-pill:before{content:"";width:7px;height:7px;border-radius:50%;background:currentColor;opacity:.85}',
			'.h5f-pill.warn{background:rgba(201,130,31,.12);color:var(--h5-warn)}',
			'.h5f-pill.bad{background:rgba(207,71,71,.12);color:var(--h5-bad)}',

			'.h5f-grid{display:grid;gap:14px;margin-bottom:16px;min-width:0}',
			'.h5f-card{position:relative;min-width:0;background:var(--h5-card);border:1px solid var(--h5-line);border-radius:14px;',
			'box-shadow:var(--h5-shadow);padding:18px}',
			'.h5f-card-title{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:0 0 14px;min-width:0}',
			'.h5f-card-title>span:first-child{font-size:13px;font-weight:650;letter-spacing:.01em;color:var(--h5-fg)}',
			'.h5f-hint{font-size:11.5px;color:var(--h5-fg3);font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',

			/* 概览 */
			'.h5f-overview{display:grid;grid-template-columns:auto 1fr;gap:24px;align-items:center}',
			'.h5f-ring{position:relative;width:146px;height:146px;border-radius:50%;flex:0 0 auto;',
			'background:conic-gradient(from -90deg,var(--h5-accent) calc(var(--p,0) * 1%),var(--h5-track) 0) ;',
			'display:flex;align-items:center;justify-content:center;transition:background .45s ease}',
			'.h5f-ring:after{content:"";position:absolute;inset:-5px;border-radius:50%;border:1px solid var(--h5-line);opacity:.5}',
			'.h5f-ring-in{width:116px;height:116px;border-radius:50%;background:var(--h5-card);display:flex;',
			'flex-direction:column;align-items:center;justify-content:center;gap:1px}',
			'.h5f-ring-val{font-size:29px;font-weight:680;letter-spacing:-1px;font-variant-numeric:tabular-nums;color:var(--h5-fg)}',
			'.h5f-ring-val small{font-size:14px;font-weight:600;color:var(--h5-fg2);margin-left:1px}',
			'.h5f-ring-cap{font-size:11px;color:var(--h5-fg3);letter-spacing:.04em;text-transform:uppercase}',
			'.h5f-metrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;min-width:0}',
			'.h5f-metric{padding:11px 13px;border-radius:10px;background:var(--h5-soft);border:1px solid var(--h5-line);min-width:0}',
			'.h5f-metric b{display:block;font-size:15px;font-weight:640;color:var(--h5-fg);',
			'white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
			'.h5f-metric span{display:block;font-size:11px;color:var(--h5-fg3);margin-bottom:3px}',
			'.h5f-control{margin-top:14px;display:flex;align-items:center;gap:9px;padding-top:13px;border-top:1px dashed var(--h5-line);',
			'font-size:12.5px;color:var(--h5-fg2);flex-wrap:wrap}',
			'.h5f-control b{color:var(--h5-fg);font-weight:640}',
			'.h5f-tag{display:inline-block;padding:2px 8px;border-radius:6px;background:var(--h5-soft);color:var(--h5-accent);',
			'font-size:11px;font-weight:600}',

			/* 温度矩阵 */
			'.h5f-temps{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;min-width:0}',
			'.h5f-temp{position:relative;min-width:0;padding:14px;border-radius:12px;border:1px solid var(--h5-line);',
			'background:var(--h5-card);transition:border-color .2s,box-shadow .2s,transform .2s}',
			'.h5f-temp[data-heat="warm"]{border-color:rgba(201,130,31,.42)}',
			'.h5f-temp[data-heat="hot"]{border-color:rgba(207,71,71,.45)}',
			'.h5f-temp[data-active="1"]{box-shadow:0 0 0 2px var(--h5-soft),var(--h5-shadow);transform:translateY(-1px)}',
			'.h5f-temp[data-state="na"]{border-style:dashed;background:transparent}',
			'.h5f-temp[data-state="na"] .h5f-temp-val{color:var(--h5-fg2);font-size:15px;font-weight:580}',
			'.h5f-temp-top{display:flex;align-items:center;gap:7px;margin-bottom:9px;min-height:18px}',
			'.h5f-dot{width:8px;height:8px;border-radius:50%;background:var(--h5-accent);flex:0 0 auto}',
			'.h5f-temp[data-heat="warm"] .h5f-dot{background:var(--h5-warn)}',
			'.h5f-temp[data-heat="hot"] .h5f-dot{background:var(--h5-bad)}',
			'.h5f-temp[data-state="na"] .h5f-dot{background:var(--h5-fg3);opacity:.55}',
			'.h5f-temp-name{font-size:12px;font-weight:620;color:var(--h5-fg2);white-space:nowrap}',
			'.h5f-temp-badge{margin-left:auto;font-size:10px;font-weight:650;letter-spacing:.02em;padding:1px 6px;',
			'border-radius:5px;background:var(--h5-soft);color:var(--h5-accent);white-space:nowrap}',
			'.h5f-temp-val{font-size:25px;font-weight:660;letter-spacing:-.6px;font-variant-numeric:tabular-nums;',
			'color:var(--h5-fg);line-height:1.15}',
			'.h5f-temp-val small{font-size:13px;font-weight:560;color:var(--h5-fg2);margin-left:2px}',
			'.h5f-bar{height:4px;border-radius:99px;background:var(--h5-track);margin:10px 0 8px;overflow:hidden}',
			'.h5f-bar i{display:block;height:100%;border-radius:99px;background:linear-gradient(90deg,var(--h5-accent),var(--h5-accent2));',
			'transition:width .5s ease,background .3s}',
			'.h5f-temp[data-heat="warm"] .h5f-bar i{background:linear-gradient(90deg,#1aa87c,var(--h5-warn))}',
			'.h5f-temp[data-heat="hot"] .h5f-bar i{background:linear-gradient(90deg,var(--h5-warn),var(--h5-bad))}',
			'.h5f-temp-src{font-size:10.5px;color:var(--h5-fg3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',

			/* 曲线 */
			'.h5f-curve{display:grid;grid-template-columns:minmax(0,1fr) 208px;gap:16px;align-items:stretch}',
			'.h5f-canvas-wrap{position:relative;min-width:0}',
			'.h5f-canvas{width:100%;height:232px;display:block;border-radius:10px}',
			'.h5f-side{display:grid;gap:9px;align-content:start}',
			'.h5f-side-item{min-width:0;padding:10px 12px;border-radius:10px;border:1px solid var(--h5-line);background:var(--h5-soft)}',
			'.h5f-side-item span{display:block;font-size:11px;color:var(--h5-fg3);margin-bottom:2px}',
			'.h5f-side-item b{font-size:17px;font-weight:640;font-variant-numeric:tabular-nums;color:var(--h5-fg);',
			'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:block}',
			'.h5f-note{margin-top:13px;padding:10px 12px;border-radius:9px;background:var(--h5-soft);',
			'border-left:3px solid var(--h5-accent);font-size:12px;color:var(--h5-fg2)}',

			/* 表单收敛 */
			'.h5f .cbi-map>h2,.h5f .cbi-map>p{display:none}',
			'.h5f .cbi-section{border:1px solid var(--h5-line);border-radius:14px;box-shadow:var(--h5-shadow);',
			'background:var(--h5-card);padding:4px 4px 10px;margin-bottom:16px}',
			'.h5f .cbi-section h3{font-size:13px;font-weight:650;color:var(--h5-fg);margin:0;padding:14px 16px 0}',
			'.h5f .cbi-value{padding:11px 16px}',
			'.h5f .cbi-value-title{color:var(--h5-fg2);font-weight:560}',
			'.h5f .cbi-value-description{color:var(--h5-fg3);font-size:11.5px}',
			'.h5f .cbi-input-text,.h5f .cbi-input-select{background:var(--h5-card) !important;color:var(--h5-fg) !important;',
			'border:1px solid var(--h5-line) !important;border-radius:8px !important;box-shadow:none !important}',
			'.h5f .cbi-button{background:var(--h5-card) !important;color:var(--h5-fg) !important;border:1px solid var(--h5-line) !important;',
			'border-radius:8px !important;box-shadow:none !important}',
			'.h5f .cbi-button-apply,.h5f .cbi-button-save{background:var(--h5-accent) !important;color:#fff !important;border-color:transparent !important}',
			'.h5f .h5f-slider{display:flex;align-items:center;gap:12px;max-width:520px}',
			'.h5f .h5f-slider input[type=range]{flex:1;min-width:180px;accent-color:var(--h5-accent)}',
			'.h5f .h5f-slider input[type=number]{width:88px}',

			'@media(max-width:1040px){.h5f-temps{grid-template-columns:repeat(2,minmax(0,1fr))}',
			'.h5f-curve{grid-template-columns:minmax(0,1fr)}.h5f-side{grid-template-columns:repeat(3,minmax(0,1fr))}}',
			'@media(max-width:760px){.h5f-overview{grid-template-columns:1fr;justify-items:center;gap:18px}',
			'.h5f-metrics{grid-template-columns:repeat(3,minmax(0,1fr));width:100%}',
			'.h5f-control{justify-content:center;text-align:center}}',
			'@media(max-width:560px){.h5f-metric.wide{grid-column:1 / -1}.h5f-head{flex-direction:column;gap:10px}.h5f-temps{grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}',
			'.h5f-side{grid-template-columns:1fr}.h5f-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.h5f-ring{width:128px;height:128px}',
			'.h5f-ring-in{width:100px;height:100px}.h5f-card{padding:15px}}'
		].join(''));
	},

	/* ------------------------------------------------------------ 结构构建 */

	tempCard: function(id, name) {
		return E('div', { 'class': 'h5f-temp', 'id': id, 'data-state': 'na' }, [
			E('div', { 'class': 'h5f-temp-top' }, [
				E('span', { 'class': 'h5f-dot' }),
				E('span', { 'class': 'h5f-temp-name' }, name),
				E('span', { 'class': 'h5f-temp-badge', 'id': id + '-badge', 'style': 'display:none' }, _('Control'))
			]),
			E('div', { 'class': 'h5f-temp-val', 'id': id + '-val' }, '—'),
			E('div', { 'class': 'h5f-bar' }, [ E('i', { 'id': id + '-bar', 'style': 'width:0%' }) ]),
			E('div', { 'class': 'h5f-temp-src', 'id': id + '-src' }, '')
		]);
	},

	overviewCard: function() {
		return E('div', { 'class': 'h5f-card' }, [
			E('div', { 'class': 'h5f-card-title' }, [
				E('span', _('Cooling overview')),
				E('span', { 'class': 'h5f-hint', 'id': 'h5f-updated' }, '')
			]),
			E('div', { 'class': 'h5f-overview' }, [
				E('div', { 'class': 'h5f-ring', 'id': 'h5f-ring', 'style': '--p:0' }, [
					E('div', { 'class': 'h5f-ring-in' }, [
						E('div', { 'class': 'h5f-ring-val', 'id': 'h5f-ring-val' }, '—'),
						E('div', { 'class': 'h5f-ring-cap' }, _('Fan output'))
					])
				]),
				E('div', {}, [
					E('div', { 'class': 'h5f-metrics' }, [
						E('div', { 'class': 'h5f-metric' }, [
							E('span', _('Requested')), E('b', { 'id': 'h5f-req' }, '—')
						]),
						E('div', { 'class': 'h5f-metric' }, [
							E('span', _('Applied')), E('b', { 'id': 'h5f-applied' }, '—')
						]),
						E('div', { 'class': 'h5f-metric wide' }, [
							E('span', _('Policy')), E('b', { 'id': 'h5f-policy' }, '—')
						])
					]),
					E('div', { 'class': 'h5f-control' }, [
						E('span', _('Control input')),
						E('b', { 'id': 'h5f-control' }, '—'),
						E('span', { 'class': 'h5f-tag', 'id': 'h5f-reason' }, '—')
					])
				])
			])
		]);
	},

	tempSection: function() {
		return E('div', { 'class': 'h5f-card' }, [
			E('div', { 'class': 'h5f-card-title' }, [
				E('span', _('Temperature sensors')),
				E('span', { 'class': 'h5f-hint' }, _('Hottest one drives the fan'))
			]),
			E('div', { 'class': 'h5f-temps' }, [
				this.tempCard('h5f-t-cpu', 'CPU'),
				this.tempCard('h5f-t-wifi', 'Wi-Fi'),
				this.tempCard('h5f-t-phy', _('Ethernet PHY')),
				this.tempCard('h5f-t-modem', _('5G modem'))
			])
		]);
	},

	curveSection: function() {
		return E('div', { 'class': 'h5f-card' }, [
			E('div', { 'class': 'h5f-card-title' }, [
				E('span', _('Fan curve')),
				E('span', { 'class': 'h5f-hint', 'id': 'h5f-curve-hint' }, '')
			]),
			E('div', { 'class': 'h5f-curve' }, [
				E('div', { 'class': 'h5f-canvas-wrap' }, [
					E('canvas', { 'class': 'h5f-canvas', 'id': 'h5f-curve', 'width': 760, 'height': 232 })
				]),
				E('div', { 'class': 'h5f-side' }, [
					E('div', { 'class': 'h5f-side-item' }, [
						E('span', _('Raw PWM')), E('b', { 'id': 'h5f-raw' }, '—')
					]),
					E('div', { 'class': 'h5f-side-item' }, [
						E('span', _('Kernel safety floor')), E('b', { 'id': 'h5f-floor' }, '—')
					]),
					E('div', { 'class': 'h5f-side-item' }, [
						E('span', _('Thermal owner')), E('b', { 'id': 'h5f-owner' }, '—')
					])
				])
			]),
			E('div', { 'class': 'h5f-note', 'id': 'h5f-safety-note' }, '')
		]);
	},

	/* ---------------------------------------------------------------- 绘制 */

	parseCurve: function(text) {
		var points = [];
		(text || '').split(',').forEach(function(pair) {
			var parts = pair.split(':'), temp = parseInt(parts[0], 10), percent = parseInt(parts[1], 10);
			if (parts.length === 2 && !isNaN(temp) && !isNaN(percent))
				points.push({ temp: temp, percent: percent });
		});
		return points;
	},

	isDark: function() {
		return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
	},

	drawCurve: function(data) {
		var canvas = document.getElementById('h5f-curve'), points = this.parseCurve(data.curve_data);
		if (!canvas || points.length < 2) return;

		var dark = this.isDark();
		var c = dark ? {
			bg1: '#1a2220', bg2: '#141c1a', grid: 'rgba(255,255,255,.07)', axis: '#7d8c87',
			line: '#2ec196', fill1: 'rgba(46,193,150,.26)', fill2: 'rgba(46,193,150,.02)',
			marker: '#e9efec', dotRing: '#2ec196', labelBg: '#0d1412', labelFg: '#e9efec'
		} : {
			bg1: '#ffffff', bg2: '#f6faf8', grid: 'rgba(16,40,34,.07)', axis: '#8b9a95',
			line: '#0f9d76', fill1: 'rgba(15,157,118,.22)', fill2: 'rgba(15,157,118,.02)',
			marker: '#16211d', dotRing: '#0f9d76', labelBg: '#16211d', labelFg: '#ffffff'
		};

		var width = canvas.clientWidth || 720, height = canvas.clientHeight || 232;
		var ratio = window.devicePixelRatio || 1;
		canvas.width = Math.round(width * ratio);
		canvas.height = Math.round(height * ratio);
		var ctx = canvas.getContext('2d');
		ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
		ctx.clearRect(0, 0, width, height);

		var padL = 34, padR = 18, padT = 18, padB = 30;
		var plotW = width - padL - padR, plotH = height - padT - padB;
		var minT = 20, maxT = 110;
		var self = this;
		var x = function(t) { return padL + self.clamp((t - minT) / (maxT - minT), 0, 1) * plotW; };
		var y = function(p) { return padT + (100 - self.clamp(p, 0, 100)) * plotH / 100; };

		var bg = ctx.createLinearGradient(0, 0, 0, height);
		bg.addColorStop(0, c.bg1); bg.addColorStop(1, c.bg2);
		ctx.fillStyle = bg; ctx.fillRect(0, 0, width, height);

		ctx.strokeStyle = c.grid; ctx.lineWidth = 1;
		ctx.font = '11px system-ui,-apple-system,sans-serif'; ctx.fillStyle = c.axis;
		[0, 25, 50, 75, 100].forEach(function(p) {
			var gy = Math.round(y(p)) + .5;
			ctx.beginPath(); ctx.moveTo(padL, gy); ctx.lineTo(padL + plotW, gy); ctx.stroke();
			ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
			ctx.fillText(p + '%', padL - 7, gy);
		});

		/* 首尾之外按"保持不变"延伸：控制器的 calc_curve_pwm 对超出末点的温度也是取末点
		   的百分比，所以曲线画到 110℃ 才和实际行为一致，否则右侧会留下一块空白。 */
		var line = points.slice();
		if (line[0].temp > minT) line.unshift({ temp: minT, percent: line[0].percent });
		if (line[line.length - 1].temp < maxT) line.push({ temp: maxT, percent: line[line.length - 1].percent });

		ctx.save();
		ctx.beginPath();
		ctx.rect(padL, padT, plotW, plotH);
		ctx.clip();

		var area = ctx.createLinearGradient(0, padT, 0, padT + plotH);
		area.addColorStop(0, c.fill1); area.addColorStop(1, c.fill2);
		ctx.beginPath();
		ctx.moveTo(x(line[0].temp), padT + plotH);
		line.forEach(function(p) { ctx.lineTo(x(p.temp), y(p.percent)); });
		ctx.lineTo(x(line[line.length - 1].temp), padT + plotH);
		ctx.closePath(); ctx.fillStyle = area; ctx.fill();

		ctx.beginPath();
		line.forEach(function(p, i) { i ? ctx.lineTo(x(p.temp), y(p.percent)) : ctx.moveTo(x(p.temp), y(p.percent)); });
		ctx.save();
		ctx.strokeStyle = c.line; ctx.lineWidth = 2.5; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
		ctx.shadowColor = dark ? 'rgba(46,193,150,.45)' : 'rgba(15,157,118,.28)';
		ctx.shadowBlur = 10;
		ctx.stroke();
		ctx.restore();

		points.forEach(function(p) {
			ctx.beginPath(); ctx.arc(x(p.temp), y(p.percent), 2.6, 0, Math.PI * 2);
			ctx.fillStyle = c.line; ctx.fill();
		});

		ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillStyle = c.axis;
		[30, 50, 70, 90, 110].forEach(function(t) {
			if (t > maxT) return;
			ctx.fillText(t + '°', x(t), padT + plotH + 8);
		});

		ctx.restore();

		var controlTemp = this.toNum(data.control_temp, NaN);
		var requested = this.toNum(data.requested_pwm, NaN);
		if (!isNaN(controlTemp) && !isNaN(requested)) {
			var mx = x(controlTemp), my = y(requested * 100 / 255);
			ctx.beginPath(); ctx.moveTo(mx, padT); ctx.lineTo(mx, padT + plotH);
			ctx.save(); ctx.setLineDash([3, 4]); ctx.strokeStyle = c.line; ctx.globalAlpha = .45;
			ctx.lineWidth = 1; ctx.stroke(); ctx.restore();

			ctx.beginPath(); ctx.arc(mx, my, 9, 0, Math.PI * 2);
			ctx.fillStyle = dark ? 'rgba(46,193,150,.22)' : 'rgba(15,157,118,.16)'; ctx.fill();
			ctx.beginPath(); ctx.arc(mx, my, 4.5, 0, Math.PI * 2);
			ctx.fillStyle = c.dotRing; ctx.fill();
			ctx.lineWidth = 1.6; ctx.strokeStyle = c.bg1; ctx.stroke();

			var text = Math.round(controlTemp) + '°C · ' + Math.round(requested * 100 / 255) + '%';
			ctx.font = '600 11px system-ui,-apple-system,sans-serif';
			var tw = ctx.measureText(text).width + 16;
			var bx = Math.max(padL, Math.min(width - tw - padR, mx - tw / 2));
			var by = Math.max(4, my - 34);
			ctx.fillStyle = c.labelBg;
			if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(bx, by, tw, 22, 6); ctx.fill(); }
			else ctx.fillRect(bx, by, tw, 22);
			ctx.fillStyle = c.labelFg; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
			ctx.fillText(text, bx + 8, by + 11.5);
		}
	},

	/* ---------------------------------------------------------------- 更新 */

	setTempCard: function(id, value, sourceText, active, available) {
		var card = document.getElementById(id);
		if (!card) return;
		var val = document.getElementById(id + '-val');
		var bar = document.getElementById(id + '-bar');
		var src = document.getElementById(id + '-src');
		var badge = document.getElementById(id + '-badge');
		var temp = this.toNum(value, NaN);

		card.dataset.active = active ? '1' : '0';
		card.dataset.state = available ? 'ok' : 'na';

		if (!available || isNaN(temp)) {
			card.dataset.heat = '';
			val.textContent = _('Not detected');
			bar.style.width = '0%';
			if (badge) badge.style.display = 'none';
		} else {
			card.dataset.heat = temp >= 70 ? 'hot' : (temp >= 55 ? 'warm' : 'cool');
			val.textContent = '';
			val.appendChild(document.createTextNode(String(temp)));
			val.appendChild(E('small', {}, '°C'));
			bar.style.width = this.clamp(temp, 0, 100) + '%';
			if (badge) badge.style.display = active ? '' : 'none';
		}
		if (src) src.textContent = sourceText || '';
	},

	updateStatus: function(data) {
		var applied = this.pct(data.applied_pwm);
		if (isNaN(applied)) applied = this.pct(data.pwm_value);

		/* 概览 */
		var ring = document.getElementById('h5f-ring');
		var ringVal = document.getElementById('h5f-ring-val');
		if (ring && !isNaN(applied)) {
			ring.style.setProperty('--p', applied);
		}
		if (ringVal) {
			ringVal.textContent = '';
			ringVal.appendChild(document.createTextNode(isNaN(applied) ? '—' : String(applied)));
			if (!isNaN(applied)) ringVal.appendChild(E('small', {}, '%'));
		}
		var req = this.pct(data.requested_pwm);
		this.setText('h5f-req', isNaN(req) ? '—' : req + '%');
		this.setText('h5f-applied', isNaN(applied) ? '—' : applied + '%');
		this.setText('h5f-policy', this.modeName(data.mode) + (data.mode === 'auto' ? ' · ' + this.profileName(data.curve) : ''));
		this.setText('h5f-reason', this.reasonName(data.reason));

		var controlText = this.has(data.control_temp)
			? _('%s (%s)').format(this.formatTemp(data.control_temp), data.control_sensor || '—')
			: _('No valid sensor');
		this.setText('h5f-control', controlText);

		/* 温度矩阵 */
		var cs = data.control_sensor || '';
		this.setTempCard('h5f-t-cpu', data.cpu_temp, data.cpu_label || _('thermal zone'),
			cs === data.cpu_label, this.has(data.cpu_temp));

		var wifiText = this.wifiSourceName(data);
		this.setTempCard('h5f-t-wifi', data.wifi1_temp, wifiText,
			cs === data.wifi1_label, this.has(data.wifi1_temp));

		this.setTempCard('h5f-t-phy', data.phy_temp, data.phy_label || '',
			cs === data.phy_label, this.has(data.phy_temp));

		var modemSrc = this.has(data.module_temp)
			? (data.module_sensor ? _('Hottest channel: %s').format(data.module_sensor) : _('Via MT5700 Console'))
			: _('Requires MT5700 Console');
		this.setTempCard('h5f-t-modem', data.module_temp, modemSrc,
			cs === '5G modem', this.has(data.module_temp));

		/* 曲线区 */
		var rawPwm = this.toNum(data.pwm_value, NaN);
		this.setText('h5f-raw', isNaN(rawPwm) ? '—' : _('%s / 255').format(rawPwm));
		var floor = this.toNum(data.thermal_floor, 0);
		this.setText('h5f-floor', floor > 0 ? this.pct(floor) + '%' : '—');
		this.setText('h5f-owner', data.thermal_owner === 'userspace' ? _('Fan manager') :
			(data.thermal_owner === 'shared' ? _('Shared with kernel') :
			(data.thermal_owner === 'kernel' ? _('Kernel') : '—')));
		var interval = this.toNum(data.interval, NaN);
		this.setText('h5f-curve-hint', (data.mode === 'auto' ? this.profileName(data.curve) : this.modeName(data.mode))
			+ (isNaN(interval) ? '' : ' · ' + _('%s s').format(interval)));

		this.setText('h5f-safety-note', data.thermal_owner === 'userspace'
			? _('The fan manager owns the fan policy. Kernel CPU throttling and critical over-temperature protection stay active.')
			: _('Kernel thermal protection is always retained; the effective output may be raised above the request when the kernel needs more cooling.'));

		/* 健康状态 */
		var health = document.getElementById('h5f-health');
		var age = this.toNum(data.state_age, NaN);
		if (health) {
			health.className = 'h5f-pill';
			if (data.result === 'failsafe') {
				health.className += ' bad';
				health.textContent = _('Failsafe cooling');
			} else if (isNaN(age) || (!isNaN(interval) && age > interval * 3 + 5)) {
				health.className += ' warn';
				health.textContent = _('Status delayed');
			} else {
				health.textContent = _('Running normally');
			}
		}
		if (!isNaN(age))
			this.setText('h5f-updated', _('%s s ago').format(age));

		this.drawCurve(data);
	},

	/* ---------------------------------------------------------------- 表单 */

	validateCurve: function(sectionId, value) {
		var points = this.parseCurve(value), last = -1;
		if (points.length < 2 || points.map(function(p) { return p.temp + ':' + p.percent; }).join(',') !== value.replace(/\s+/g, ''))
			return _('Use comma-separated temperature:percent points, for example 35:0,45:50,70:80,90:100.');
		for (var i = 0; i < points.length; i++) {
			if (points[i].temp <= last || points[i].temp < 0 || points[i].temp > 150 || points[i].percent < 0 || points[i].percent > 100)
				return _('Temperatures must increase from 0–150 °C and percentages must be 0–100.');
			last = points[i].temp;
		}
		return true;
	},

	renderManualPwmWidget: function(option) {
		option.renderWidget = function(sectionId, optionIndex, cfgvalue) {
			var value = cfgvalue || this.default || '160', id = this.cbid(sectionId), rangeId = id + '-range', numberId = id + '-number';
			function sync(value, source) {
				var range = document.getElementById(rangeId), number = document.getElementById(numberId), hidden = document.getElementById(id);
				value = Math.max(0, Math.min(255, parseInt(value, 10) || 0));
				if (range && source !== range) range.value = value;
				if (number && source !== number) number.value = value;
				if (hidden) hidden.value = value;
			}
			return E('div', { 'class': 'h5f-slider' }, [
				E('input', { id: rangeId, type: 'range', min: 0, max: 255, step: 1, value: value, oninput: function(ev) { sync(ev.target.value, ev.target); } }),
				E('input', { id: numberId, type: 'number', min: 0, max: 255, step: 1, value: value, oninput: function(ev) { sync(ev.target.value, ev.target); } }),
				E('input', { id: id, name: id, type: 'hidden', value: value })
			]);
		};
	},

	renderForm: function() {
		var m = new form.Map('h5000m_fancontrol', _('Cooling policy'));
		var s = m.section(form.NamedSection, 'settings', 'settings'), o;
		m.description = _('Pick a profile or a fixed output. Safety limits stay active in every mode.');
		s.anonymous = true;
		s.tab('policy', _('Policy'));
		s.tab('safety', _('Response & safety'));

		o = s.taboption('policy', form.Flag, 'enabled', _('Enable enhanced controller'));
		o.default = '1'; o.rmempty = false;
		o.description = _('When disabled, the fan follows the kernel thermal protection level only.');

		o = s.taboption('policy', form.ListValue, 'mode', _('Operating mode'));
		o.value('auto', _('Automatic')); o.value('manual', _('Manual')); o.value('kernel', _('Kernel protection only'));
		o.default = 'auto'; o.rmempty = false; o.depends('enabled', '1');

		o = s.taboption('policy', form.ListValue, 'curve', _('Cooling profile'));
		o.value('silent', _('Quiet')); o.value('balanced', _('Balanced')); o.value('performance', _('Performance')); o.value('custom', _('Custom'));
		o.default = 'balanced'; o.rmempty = false; o.depends({ enabled: '1', mode: 'auto' });

		o = s.taboption('policy', form.Value, 'curve_custom', _('Custom curve'));
		o.default = '20:0,40:50,55:60,70:75,85:90,95:100'; o.rmempty = false; o.depends({ enabled: '1', mode: 'auto', curve: 'custom' });
		o.description = _('Comma-separated temperature:percent points. The controller interpolates between them.');
		o.validate = L.bind(this.validateCurve, this);

		o = s.taboption('policy', form.ListValue, 'temp_source', _('Control temperature'));
		o.value('max', _('Hottest available sensor')); o.value('cpu', _('CPU only')); o.default = 'max'; o.rmempty = false;
		o.depends({ enabled: '1', mode: 'auto' });
		o.description = _('Hottest available considers CPU, Wi-Fi, Ethernet PHY and the 5G modem.');

		o = s.taboption('policy', form.Value, 'manual_pwm', _('Manual PWM output'));
		o.datatype = 'range(0,255)'; o.default = '160'; o.rmempty = false; o.depends({ enabled: '1', mode: 'manual' });
		o.description = _('The kernel safety floor may raise the effective output above this value.');
		this.renderManualPwmWidget(o);

		o = s.taboption('safety', form.ListValue, 'wifi_temp_source', _('Wi-Fi temperature'));
		o.value('auto', _('Query the radio driver')); o.value('off', _('Do not read'));
		o.default = 'auto'; o.rmempty = false;
		o.description = _('The MT7992 exposes its chip temperature only through private driver statistics, so it is polled at a throttled rate and cached.');

		o = s.taboption('safety', form.Value, 'wifi_temp_interval', _('Wi-Fi poll interval'));
		o.datatype = 'range(5,3600)'; o.default = '30'; o.rmempty = false; o.depends('wifi_temp_source', 'auto');
		o.description = _('Seconds between radio-driver queries. The dashboard refresh does not query the driver.');

		o = s.taboption('safety', form.Value, 'interval', _('Control interval'));
		o.datatype = 'range(2,60)'; o.default = '5'; o.rmempty = false;
		o.description = _('Seconds between control decisions. The dashboard refreshes independently.');

		o = s.taboption('safety', form.Value, 'hysteresis', _('Temperature hysteresis'));
		o.datatype = 'range(0,10)'; o.default = '2'; o.rmempty = false;
		o.description = _('Prevents repeated speed changes around a curve point.');

		o = s.taboption('safety', form.Value, 'down_delay', _('Speed-down delay'));
		o.datatype = 'range(0,300)'; o.default = '30'; o.rmempty = false;
		o.description = _('Wait this many seconds before lowering output; temperature increases apply immediately.');

		o = s.taboption('safety', form.Value, 'start_pwm', _('Startup boost PWM'));
		o.datatype = 'range(80,255)'; o.default = '192'; o.rmempty = false;

		o = s.taboption('safety', form.Value, 'start_boost_ms', _('Startup boost duration'));
		o.datatype = 'range(0,3000)'; o.default = '700'; o.rmempty = false;
		o.description = _('A short boost helps a stopped fan start reliably. Set 0 to disable.');

		m.handleSaveApply = function(ev, mode) {
			return form.Map.prototype.handleSaveApply.apply(this, [ ev, mode ]).then(function() {
				return fs.exec('/etc/init.d/h5000m-fancontrol', [ 'restart' ]);
			}).then(function() {
				ui.addNotification(null, E('p', _('Cooling policy applied successfully.')));
			}, function(err) {
				ui.addNotification(null, E('p', _('Failed to apply cooling policy:') + ' ' + err.message), 'danger');
			});
		};
		return m;
	},

	/* ---------------------------------------------------------------- 渲染 */

	render: function(data) {
		var formMap = this.renderForm();
		return formMap.render().then(L.bind(function(formNode) {
			var root = E('div', { 'class': 'h5f' }, [
				this.styleNode(),
				E('div', { 'class': 'h5f-head' }, [
					E('div', {}, [
						E('div', { 'class': 'h5f-title', 'style': 'margin-bottom:5px' }, _('Cooling management')),
						E('div', { 'class': 'h5f-sub' }, _('Fan output follows the hottest sensor through a temperature curve. Kernel protection stays in charge of throttling and emergency cooling.'))
					]),
					E('div', { 'class': 'h5f-pill', 'id': 'h5f-health' }, _('Checking…'))
				]),
				this.overviewCard(),
				this.tempSection(),
				this.curveSection(),
				formNode
			]);
			window.setTimeout(L.bind(function() { this.updateStatus(data); }, this), 0);
			window.addEventListener('resize', L.bind(function() { this.drawCurve(data); }, this));
			poll.add(L.bind(function() {
				return this.fetchStatus().then(L.bind(function(next) {
					data = next;
					this.updateStatus(next);
				}, this));
			}, this), 3);
			return root;
		}, this));
	}
});

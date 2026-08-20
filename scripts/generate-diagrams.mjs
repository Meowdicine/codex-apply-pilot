import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = path.join(projectRoot, 'docs', 'diagrams');

const palette = {
  blue: { fill: '#dae8fc', stroke: '#6c8ebf', label: '本地模块' },
  green: { fill: '#d5e8d4', stroke: '#82b366', label: '已验证结果' },
  yellow: { fill: '#fff2cc', stroke: '#d6b656', label: '决策或授权' },
  orange: { fill: '#ffe6cc', stroke: '#d79b00', label: '外部动作' },
  red: { fill: '#f8cecc', stroke: '#b85450', label: '停止或未知' },
  grey: { fill: '#f5f5f5', stroke: '#666666', label: '第三方系统' },
  purple: { fill: '#e1d5e7', stroke: '#9673a6', label: '秘密或安全边界' }
};

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function drawioLabel(value) {
  return String(value).split('\n').map(escapeXml).join('&#xa;');
}

function nodeStyle(node) {
  const color = palette[node.color || 'blue'];
  const common = `whiteSpace=wrap;html=1;fillColor=${color.fill};strokeColor=${color.stroke};fontColor=#1f2937;fontSize=14;`;
  if (node.kind === 'title') return 'text;html=1;align=left;verticalAlign=middle;fontSize=24;fontStyle=1;fontColor=#111827;';
  if (node.kind === 'decision') return `rhombus;${common}`;
  if (node.kind === 'database') return `shape=cylinder3;boundedLbl=1;backgroundOutline=1;${common}`;
  if (node.kind === 'ellipse') return `ellipse;${common}`;
  if (node.kind === 'container') return `swimlane;startSize=36;horizontal=1;container=1;collapsible=0;pointerEvents=0;${common}`;
  return `rounded=1;arcSize=12;${common}${node.external ? 'dashed=1;dashPattern=8 4;' : ''}`;
}

function connectionPoints(source, target) {
  if (target.x >= source.x + source.width) {
    return { fromX: source.x + source.width, fromY: source.y + source.height / 2, toX: target.x, toY: target.y + target.height / 2, exitX: 1, exitY: 0.5, entryX: 0, entryY: 0.5, orientation: 'horizontal' };
  }
  if (source.x >= target.x + target.width) {
    return { fromX: source.x, fromY: source.y + source.height / 2, toX: target.x + target.width, toY: target.y + target.height / 2, exitX: 0, exitY: 0.5, entryX: 1, entryY: 0.5, orientation: 'horizontal' };
  }
  if (target.y >= source.y + source.height) {
    return { fromX: source.x + source.width / 2, fromY: source.y + source.height, toX: target.x + target.width / 2, toY: target.y, exitX: 0.5, exitY: 1, entryX: 0.5, entryY: 0, orientation: 'vertical' };
  }
  return { fromX: source.x + source.width / 2, fromY: source.y, toX: target.x + target.width / 2, toY: target.y + target.height, exitX: 0.5, exitY: 0, entryX: 0.5, entryY: 1, orientation: 'vertical' };
}

function edgeStyle(edge, source, target) {
  const color = palette[edge.color || 'blue'];
  const points = connectionPoints(source, target);
  return [
    'edgeStyle=orthogonalEdgeStyle',
    'rounded=1',
    'orthogonalLoop=1',
    'jettySize=auto',
    'html=1',
    `strokeColor=${color.stroke}`,
    'strokeWidth=2',
    edge.dashed ? 'dashed=1' : '',
    `exitX=${points.exitX}`,
    `exitY=${points.exitY}`,
    'exitDx=0',
    'exitDy=0',
    `entryX=${points.entryX}`,
    `entryY=${points.entryY}`,
    'entryDx=0',
    'entryDy=0'
  ].filter(Boolean).join(';') + ';';
}

function createDrawio(diagram) {
  let nextCellId = 2;
  const ids = new Map();
  for (const node of diagram.nodes) ids.set(node.id, String(nextCellId++));
  const edgeIds = diagram.edges.map(() => String(nextCellId++));
  const legendId = String(nextCellId++);
  const legendEntries = diagram.legend.map((color) => ({ color, id: String(nextCellId++), textId: String(nextCellId++) }));

  const nodeCells = diagram.nodes.map((node) => {
    const parent = node.parent ? ids.get(node.parent) : '1';
    return `        <mxCell id="${ids.get(node.id)}" value="${drawioLabel(node.label)}" style="${nodeStyle(node)}" vertex="1" parent="${parent}">\n          <mxGeometry x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" as="geometry" />\n        </mxCell>`;
  }).join('\n');

  const nodesById = new Map(diagram.nodes.map((node) => [node.id, node]));
  const absolute = new Map(diagram.nodes.map((node) => [node.id, absoluteNode(node, nodesById)]));
  const edgeCells = diagram.edges.map((edge, index) => {
    const points = edge.points?.length
      ? `\n            <Array as="points">${edge.points.map((point) => `\n              <mxPoint x="${point.x}" y="${point.y}" />`).join('')}\n            </Array>\n          `
      : '';
    return `        <mxCell id="${edgeIds[index]}" value="${drawioLabel(edge.label || '')}" style="${edgeStyle(edge, absolute.get(edge.from), absolute.get(edge.to))}" edge="1" parent="1" source="${ids.get(edge.from)}" target="${ids.get(edge.to)}">\n          <mxGeometry relative="1" as="geometry">${points}</mxGeometry>\n        </mxCell>`;
  }).join('\n');

  const legendX = diagram.width - 230;
  const legendY = diagram.height - (50 + diagram.legend.length * 26);
  const legendCells = [
    `        <mxCell id="${legendId}" value="图例" style="rounded=0;whiteSpace=wrap;html=1;fillColor=none;strokeColor=#6b7280;verticalAlign=top;fontStyle=1;fontColor=#374151;container=1;pointerEvents=0;" vertex="1" parent="1">\n          <mxGeometry x="${legendX}" y="${legendY}" width="200" height="${38 + diagram.legend.length * 26}" as="geometry" />\n        </mxCell>`,
    ...legendEntries.flatMap((entry, index) => {
      const color = palette[entry.color];
      const y = 30 + index * 26;
      return [
        `        <mxCell id="${entry.id}" value="" style="rounded=0;html=1;fillColor=${color.fill};strokeColor=${color.stroke};" vertex="1" parent="${legendId}">\n          <mxGeometry x="10" y="${y}" width="30" height="16" as="geometry" />\n        </mxCell>`,
        `        <mxCell id="${entry.textId}" value="${escapeXml(color.label)}" style="text;html=1;align=left;verticalAlign=middle;fontColor=#374151;fontSize=12;" vertex="1" parent="${legendId}">\n          <mxGeometry x="50" y="${y - 2}" width="135" height="20" as="geometry" />\n        </mxCell>`
      ];
    })
  ].join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<mxfile host="drawio" version="26.0.0" modified="${new Date(0).toISOString()}" agent="codex-apply-pilot">
  <diagram name="${escapeXml(diagram.title)}">
    <mxGraphModel dx="1422" dy="762" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="${diagram.width}" pageHeight="${diagram.height}" math="0" shadow="0">
      <root>
        <mxCell id="0" />
        <mxCell id="1" parent="0" />
${nodeCells}
${edgeCells}
${legendCells}
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>
`;
}

function absoluteNode(node, nodesById) {
  if (!node.parent) return { ...node };
  const parent = absoluteNode(nodesById.get(node.parent), nodesById);
  return { ...node, x: parent.x + node.x, y: parent.y + node.y };
}

function svgText(node, absolute) {
  const lines = String(node.label).split('\n');
  const startY = absolute.y + absolute.height / 2 - ((lines.length - 1) * 10);
  return `<text x="${absolute.x + absolute.width / 2}" y="${startY}" text-anchor="middle" dominant-baseline="middle" font-family="Segoe UI, Noto Sans SC, sans-serif" font-size="${node.kind === 'title' ? 24 : 14}" font-weight="${node.kind === 'title' ? 700 : 500}" fill="#1f2937">${lines.map((line, index) => `<tspan x="${absolute.x + absolute.width / 2}" dy="${index === 0 ? 0 : 21}">${escapeXml(line)}</tspan>`).join('')}</text>`;
}

function svgNode(node, absolute) {
  const color = palette[node.color || 'blue'];
  const dash = node.external ? ' stroke-dasharray="8 4"' : '';
  if (node.kind === 'title') return svgText(node, absolute);
  if (node.kind === 'container') {
    return `<g><rect x="${absolute.x}" y="${absolute.y}" width="${absolute.width}" height="${absolute.height}" rx="8" fill="${color.fill}" fill-opacity="0.28" stroke="${color.stroke}" stroke-width="2"/><line x1="${absolute.x}" y1="${absolute.y + 36}" x2="${absolute.x + absolute.width}" y2="${absolute.y + 36}" stroke="${color.stroke}"/><text x="${absolute.x + 14}" y="${absolute.y + 23}" font-family="Segoe UI, Noto Sans SC, sans-serif" font-size="15" font-weight="700" fill="#1f2937">${escapeXml(node.label)}</text></g>`;
  }
  let shape;
  if (node.kind === 'decision') {
    const cx = absolute.x + absolute.width / 2;
    const cy = absolute.y + absolute.height / 2;
    shape = `<polygon points="${cx},${absolute.y} ${absolute.x + absolute.width},${cy} ${cx},${absolute.y + absolute.height} ${absolute.x},${cy}" fill="${color.fill}" stroke="${color.stroke}" stroke-width="2"/>`;
  } else if (node.kind === 'ellipse') {
    shape = `<ellipse cx="${absolute.x + absolute.width / 2}" cy="${absolute.y + absolute.height / 2}" rx="${absolute.width / 2}" ry="${absolute.height / 2}" fill="${color.fill}" stroke="${color.stroke}" stroke-width="2"/>`;
  } else if (node.kind === 'database') {
    shape = `<path d="M ${absolute.x} ${absolute.y + 10} C ${absolute.x} ${absolute.y - 3}, ${absolute.x + absolute.width} ${absolute.y - 3}, ${absolute.x + absolute.width} ${absolute.y + 10} L ${absolute.x + absolute.width} ${absolute.y + absolute.height - 10} C ${absolute.x + absolute.width} ${absolute.y + absolute.height + 3}, ${absolute.x} ${absolute.y + absolute.height + 3}, ${absolute.x} ${absolute.y + absolute.height - 10} Z" fill="${color.fill}" stroke="${color.stroke}" stroke-width="2"/>`;
  } else {
    shape = `<rect x="${absolute.x}" y="${absolute.y}" width="${absolute.width}" height="${absolute.height}" rx="12" fill="${color.fill}" stroke="${color.stroke}" stroke-width="2"${dash}/>`;
  }
  return `<g>${shape}${svgText(node, absolute)}</g>`;
}

function svgEdge(edge, source, target) {
  const color = palette[edge.color || 'blue'];
  const points = connectionPoints(source, target);
  const { fromX, fromY, toX, toY, orientation } = points;
  let pathData;
  let labelX;
  let labelY;
  if (edge.points?.length) {
    const allPoints = [{ x: fromX, y: fromY }, ...edge.points, { x: toX, y: toY }];
    pathData = allPoints.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');
    const middle = edge.points[Math.floor((edge.points.length - 1) / 2)];
    labelX = middle.x;
    labelY = middle.y - 12;
  } else if (orientation === 'horizontal') {
    const middleX = Math.round((fromX + toX) / 2);
    pathData = `M ${fromX} ${fromY} L ${middleX} ${fromY} L ${middleX} ${toY} L ${toX} ${toY}`;
    labelX = middleX;
    labelY = Math.round((fromY + toY) / 2) - 12;
  } else {
    const middleY = Math.round((fromY + toY) / 2);
    pathData = `M ${fromX} ${fromY} L ${fromX} ${middleY} L ${toX} ${middleY} L ${toX} ${toY}`;
    labelX = Math.round((fromX + toX) / 2);
    labelY = middleY - 12;
  }
  const dash = edge.dashed ? ' stroke-dasharray="8 4"' : '';
  const labelWidth = Math.min(230, Math.max(54, String(edge.label || '').length * 12));
  const label = edge.label ? `<rect x="${labelX - labelWidth / 2}" y="${labelY - 13}" width="${labelWidth}" height="20" rx="4" fill="#ffffff" fill-opacity="0.94"/><text x="${labelX}" y="${labelY + 1}" text-anchor="middle" font-family="Segoe UI, Noto Sans SC, sans-serif" font-size="12" fill="#374151">${escapeXml(edge.label)}</text>` : '';
  return `<g><path d="${pathData}" fill="none" stroke="${color.stroke}" stroke-width="2" marker-end="url(#arrow-${edge.color || 'blue'})"${dash}/>${label}</g>`;
}

function createSvg(diagram) {
  const nodesById = new Map(diagram.nodes.map((node) => [node.id, node]));
  const absolute = new Map(diagram.nodes.map((node) => [node.id, absoluteNode(node, nodesById)]));
  const usedColors = [...new Set([...diagram.nodes.map((node) => node.color || 'blue'), ...diagram.edges.map((edge) => edge.color || 'blue')])];
  const markers = usedColors.map((name) => `<marker id="arrow-${name}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="${palette[name].stroke}"/></marker>`).join('');
  const containers = diagram.nodes.filter((node) => node.kind === 'container');
  const ordinaryNodes = diagram.nodes.filter((node) => node.kind !== 'container');
  const edgeSvg = diagram.edges.map((edge) => svgEdge(edge, absolute.get(edge.from), absolute.get(edge.to))).join('\n  ');
  const nodeSvg = [...containers, ...ordinaryNodes].map((node) => svgNode(node, absolute.get(node.id))).join('\n  ');
  const legendX = diagram.width - 220;
  const legendY = diagram.height - (45 + diagram.legend.length * 25);
  const legendSvg = `<g><rect x="${legendX}" y="${legendY}" width="190" height="${35 + diagram.legend.length * 25}" fill="#ffffff" stroke="#6b7280"/><text x="${legendX + 10}" y="${legendY + 20}" font-family="Segoe UI, Noto Sans SC, sans-serif" font-size="13" font-weight="700" fill="#374151">图例</text>${diagram.legend.map((name, index) => { const color = palette[name]; const y = legendY + 29 + index * 25; return `<rect x="${legendX + 10}" y="${y}" width="28" height="14" fill="${color.fill}" stroke="${color.stroke}"/><text x="${legendX + 48}" y="${y + 12}" font-family="Segoe UI, Noto Sans SC, sans-serif" font-size="12" fill="#374151">${escapeXml(color.label)}</text>`; }).join('')}</g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${diagram.width}" height="${diagram.height}" viewBox="0 0 ${diagram.width} ${diagram.height}" role="img" aria-labelledby="title desc">
  <title id="title">${escapeXml(diagram.title)}</title>
  <desc id="desc">${escapeXml(diagram.description)}</desc>
  <defs>${markers}</defs>
  <rect width="100%" height="100%" fill="#ffffff"/>
  ${edgeSvg}
  ${nodeSvg}
  ${legendSvg}
</svg>
`;
}

const diagrams = [
  {
    slug: 'system-architecture',
    title: '系统架构',
    description: '用户、Codex 插件、本地状态、秘密库、Simplify 官方界面与雇主门户之间的边界。',
    width: 1420,
    height: 820,
    legend: ['blue', 'purple', 'grey', 'green'],
    nodes: [
      { id: 'title', label: 'Codex Apply Pilot｜本地优先架构', x: 40, y: 20, width: 700, height: 40, kind: 'title' },
      { id: 'user', label: '用户\n事实确认与安全动作', x: 50, y: 310, width: 190, height: 90, color: 'blue' },
      { id: 'plugin', label: 'Codex Plugin + CLI\n问卷、策略、状态机', x: 330, y: 290, width: 240, height: 120, color: 'blue' },
      { id: 'simplify', label: 'Simplify 官方 UI\nCopilot / Resume Builder', x: 330, y: 90, width: 240, height: 100, color: 'grey', external: true },
      { id: 'state', label: '本地状态与回执\n无秘密、原子写入', x: 670, y: 100, width: 220, height: 100, kind: 'database', color: 'green' },
      { id: 'vault', label: 'OS Credential Store\n只保存 secretRef', x: 330, y: 540, width: 220, height: 90, color: 'purple' },
      { id: 'portal', label: '已验证条款的雇主门户\n候选级适配器', x: 1040, y: 310, width: 270, height: 100, color: 'grey', external: true },
      { id: 'receipt', label: '官方成功回执\n或 unknown no-repeat', x: 670, y: 540, width: 220, height: 90, color: 'green' }
    ],
    edges: [
      { from: 'user', to: 'plugin', label: '明确事实与模式选择', color: 'blue' },
      { from: 'plugin', to: 'state', label: '策略 / CAS / 审计', color: 'green' },
      { from: 'plugin', to: 'vault', label: '仅使用引用', color: 'purple' },
      { from: 'user', to: 'simplify', label: '官方界面操作', color: 'grey', dashed: true },
      { from: 'simplify', to: 'plugin', label: '用户确认的产物', color: 'grey', dashed: true },
      { from: 'plugin', to: 'portal', label: '允许域名 + 精确候选', color: 'orange' },
      { from: 'portal', to: 'receipt', label: '一次最终点击', color: 'green' },
      { from: 'receipt', to: 'state', label: '验证或安全停车', color: 'green' }
    ]
  },
  {
    slug: 'semi-vs-full-state-machine',
    title: '半自动与全自动状态机',
    description: '共享准备流程、半自动两道 Gate、全自动成熟度准入和共同的 exactly-once 提交协议。',
    width: 1540,
    height: 820,
    legend: ['blue', 'yellow', 'orange', 'red', 'green'],
    nodes: [
      { id: 'title', label: '两种模式，共享事实与安全底座', x: 40, y: 20, width: 700, height: 40, kind: 'title' },
      { id: 'start', label: '官方来源已核验', x: 40, y: 170, width: 190, height: 70, kind: 'ellipse', color: 'blue' },
      { id: 'prepare', label: '真实简历精修\nQA + hash 冻结', x: 310, y: 150, width: 210, height: 100, color: 'blue' },
      { id: 'mode', label: '选择模式', x: 600, y: 150, width: 160, height: 100, kind: 'decision', color: 'yellow' },
      { id: 'gate1', label: 'Gate 1\n审核精确简历 hash', x: 850, y: 70, width: 200, height: 90, color: 'yellow' },
      { id: 'account', label: '用户注册 / 登录\n普通准备继续', x: 1120, y: 70, width: 200, height: 90, color: 'orange' },
      { id: 'gate2', label: 'Gate 2\n审核精确 manifest', x: 850, y: 240, width: 200, height: 90, color: 'yellow' },
      { id: 'readiness', label: '全自动成熟度\n同意、域名、上限', x: 850, y: 430, width: 200, height: 90, color: 'yellow' },
      { id: 'preflight', label: '策略化 preflight\n新门户降级半自动', x: 1120, y: 430, width: 200, height: 90, color: 'orange' },
      { id: 'intent', label: '先写 submit intent\n再允许一次点击', x: 1120, y: 250, width: 210, height: 100, color: 'orange' },
      { id: 'success', label: '官方成功\n终态 no-repeat', x: 1360, y: 260, width: 150, height: 80, kind: 'ellipse', color: 'green' },
      { id: 'hardstop', label: 'CAPTCHA / OTP / 缺失事实\n安全停车，不猜测', x: 600, y: 620, width: 270, height: 90, color: 'red' }
    ],
    edges: [
      { from: 'start', to: 'prepare', color: 'blue' },
      { from: 'prepare', to: 'mode', color: 'blue' },
      { from: 'mode', to: 'gate1', label: '半自动', color: 'yellow' },
      { from: 'gate1', to: 'account', label: '批准简历', color: 'orange' },
      { from: 'account', to: 'gate2', label: '表单已预检', color: 'orange' },
      { from: 'gate2', to: 'intent', label: '批准提交', color: 'yellow' },
      { from: 'mode', to: 'readiness', label: '全自动', color: 'yellow' },
      { from: 'readiness', to: 'preflight', label: '全部检查通过', color: 'orange' },
      { from: 'preflight', to: 'intent', label: 'standing authorization', color: 'orange' },
      { from: 'intent', to: 'success', label: '官方回执', color: 'green' },
      { from: 'prepare', to: 'hardstop', label: '不真实 / 无法验证', color: 'red', dashed: true },
      { from: 'preflight', to: 'hardstop', label: '安全挑战', color: 'red', dashed: true }
    ]
  },
  {
    slug: 'security-boundaries',
    title: '安全与信任边界',
    description: '本地事实、秘密库、浏览器工作区、人工安全动作和第三方系统之间的数据边界。',
    width: 1500,
    height: 820,
    legend: ['blue', 'purple', 'grey', 'red'],
    nodes: [
      { id: 'title', label: '安全与信任边界｜秘密不进入仓库或日志', x: 40, y: 20, width: 800, height: 40, kind: 'title' },
      { id: 'local', label: '本地受控边界', x: 40, y: 90, width: 420, height: 570, kind: 'container', color: 'blue' },
      { id: 'facts', parent: 'local', label: '问卷事实\n来源与有效期', x: 50, y: 80, width: 150, height: 80, color: 'blue' },
      { id: 'ledger', parent: 'local', label: '状态与回执\n候选级 no-repeat', x: 220, y: 80, width: 160, height: 80, kind: 'database', color: 'blue' },
      { id: 'secrets', parent: 'local', label: 'OS Secret Vault\n密码 / token 不渲染', x: 110, y: 260, width: 200, height: 90, color: 'purple' },
      { id: 'browser', label: '用户浏览器边界', x: 520, y: 90, width: 420, height: 570, kind: 'container', color: 'orange' },
      { id: 'adapter', parent: 'browser', label: '候选级适配器\n精确 HTTPS 与域名', x: 50, y: 80, width: 170, height: 90, color: 'orange' },
      { id: 'human', parent: 'browser', label: '人工安全动作\nCAPTCHA / OTP / OAuth', x: 90, y: 280, width: 240, height: 100, color: 'red' },
      { id: 'external', label: '第三方系统边界', x: 1000, y: 90, width: 420, height: 570, kind: 'container', color: 'grey' },
      { id: 'simplify', parent: 'external', label: 'Simplify 官方 UI\n仅用户/官方功能', x: 50, y: 80, width: 170, height: 90, color: 'grey', external: true },
      { id: 'employer', parent: 'external', label: '雇主门户\n逐站条款与 allowlist', x: 50, y: 250, width: 190, height: 90, color: 'grey', external: true },
      { id: 'challenge', parent: 'external', label: '安全挑战\n不绕过', x: 110, y: 420, width: 180, height: 80, color: 'red' }
    ],
    edges: [
      { from: 'facts', to: 'adapter', label: '已验证普通事实', color: 'blue' },
      { from: 'secrets', to: 'adapter', label: '运行时 secretRef', color: 'purple', dashed: true },
      { from: 'adapter', to: 'employer', label: '允许的表单动作', color: 'orange' },
      { from: 'human', to: 'challenge', label: '仅用户完成', color: 'red' },
      { from: 'adapter', to: 'simplify', label: '只生成用户操作步骤', color: 'grey', dashed: true },
      { from: 'employer', to: 'ledger', label: '非秘密官方回执', color: 'blue', points: [{ x: 970, y: 610 }, { x: 480, y: 610 }, { x: 480, y: 210 }] }
    ]
  },
  {
    slug: 'exactly-once-submit',
    title: '最终提交的 at-most-once 协议',
    description: '先持久化提交意图，再执行一次点击；未知结果永不重试，只能凭官方回执收敛。',
    width: 1500,
    height: 760,
    legend: ['blue', 'orange', 'green', 'red'],
    nodes: [
      { id: 'title', label: '最终提交｜write intent before click', x: 40, y: 20, width: 700, height: 40, kind: 'title' },
      { id: 'ready', label: '候选 preflight 通过\nsubmitAttemptCount = 0', x: 50, y: 210, width: 220, height: 100, color: 'blue' },
      { id: 'ledger', label: '原子写入 submit-intent\n消费 idempotency key', x: 350, y: 210, width: 250, height: 100, kind: 'database', color: 'blue' },
      { id: 'click', label: '雇主门户\n允许一次 final click', x: 690, y: 210, width: 220, height: 100, color: 'orange', external: true },
      { id: 'observed', label: '结果是否明确？', x: 1010, y: 210, width: 180, height: 100, kind: 'decision', color: 'yellow' },
      { id: 'success', label: '官方成功回执\nsubmitted-verified', x: 1270, y: 100, width: 190, height: 90, color: 'green' },
      { id: 'unknown', label: 'unknown-submit-state\nNO RETRY', x: 1270, y: 350, width: 190, height: 90, color: 'red' },
      { id: 'reconcile', label: '之后若见官方回执\n只 reconcile，不再点击', x: 970, y: 520, width: 250, height: 90, color: 'green' }
    ],
    edges: [
      { from: 'ready', to: 'ledger', label: 'CAS stateVersion', color: 'blue' },
      { from: 'ledger', to: 'click', label: 'intent 已持久化', color: 'orange' },
      { from: 'click', to: 'observed', label: '最多一次', color: 'orange' },
      { from: 'observed', to: 'success', label: '是', color: 'green' },
      { from: 'observed', to: 'unknown', label: '否 / 超时', color: 'red' },
      { from: 'unknown', to: 'reconcile', label: '只读核验', color: 'green', dashed: true },
      { from: 'reconcile', to: 'success', label: '官方证据', color: 'green', dashed: true }
    ]
  }
];

await mkdir(outputDirectory, { recursive: true });
for (const diagram of diagrams) {
  await writeFile(path.join(outputDirectory, `${diagram.slug}.drawio`), createDrawio(diagram), 'utf8');
  await writeFile(path.join(outputDirectory, `${diagram.slug}.svg`), createSvg(diagram), 'utf8');
}

process.stdout.write(`已生成 ${diagrams.length} 份 draw.io 源文件和 SVG 预览：${outputDirectory}\n`);

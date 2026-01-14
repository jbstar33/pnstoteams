
/**
 * origin-to-adaptive.js
 * 원본(origin) 데이터(JSON) → Teams Adaptive Card 메시지(JSON) 변환기
 *
 * 사용:
 *   node origin-to-adaptive.js input.json > adaptive_payload.json
 *   node origin-to-adaptive.js --stdin < raw.txt > adaptive_payload.json
 *
 * 옵션(예시):
 *   --title "결제 트랜잭션 상세 정보"
 *   --version 1.5
 *   --indent 5                // 들여쓰기 NBSP 수
 *   --truncate 80             // 너무 긴 값은 잘라서 "..." 처리
 *   --single                   // 한 TextBlock에 \n으로 묶기 (기본: line-by-line TextBlock)
 *   --no-mono                  // fontType=Monospace 비활성화
 *
 * 비고:
 *  - Adaptive Card의 모노스페이스 폰트는 v1.5 이상에서만 적용됩니다.
 *  - NBSP(\u00A0)를 사용하여 들여쓰기를 안정적으로 유지합니다(공백 축약 방지).
 */

const fs = require('fs');

const NBSP = '\u00A0';

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const [key, val] = a.includes('=') ? a.split('=') : [a, argv[i + 1]];
      const k = key.replace(/^--/, '');
      if (k === 'single' || k === 'no-mono' || k === 'stdin') {
        args[k] = true;
        if (!a.includes('=')) continue;
      } else {
        args[k] = val;
        if (!a.includes('=')) i++;
      }
    } else {
      args._.push(a);
    }
  }
  return args;
}

function readInput(args) {
  if (args.stdin) {
    try {
      return fs.readFileSync(0, 'utf8'); // stdin
    } catch {
      return '';
    }
  }
  // 파일 인자는 --stdin이 아닐 때만 요구
  const file = args._[0];
  if (!file) {
    console.error('Usage: node origin-to-adaptive.js <input.json> [options]');
    process.exit(1);
  }
  return fs.readFileSync(file, 'utf8');
}

function tryParseJSON(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * 값을 JSON-풍 문자열로 변환 (문자열은 따옴표 유지, 숫자/불리언은 리터럴 유지)
 */
function formatValue(val, { truncateLen = 0 } = {}) {
  const t = typeof val;
  let s;
  if (t === 'string') {
    s = val;
    if (truncateLen > 0 && s.length > truncateLen) {
      s = s.slice(0, truncateLen) + '...';
    }
    return `"${s}"`;
  }
  if (t === 'number' || t === 'boolean') return String(val);
  if (Array.isArray(val)) {
    return '[Array]'; // 본문에서 별도로 처리
  }
  if (val && t === 'object') return '{Object}';
  return 'null';
}

/**
 * 들여쓰기 NBSP 문자열 생성
 */
function indent(nbspCount = 5) {
  return NBSP.repeat(nbspCount);
}

/**
 * 원본 객체 → "JSON처럼 보이는" 문자열 라인 배열
 * - { 로 시작, } 로 끝
 * - 배열(paymentTypeList 등)은 보기 좋게 내부 라인으로 풀어서 표시
 */
function originToPrettyLines(origin, {
  indentSize = 5,
  truncateLen = 0,
} = {}) {
  const lines = [];
  const ind = indent(indentSize);
  const ind2 = indent(indentSize + 2);

  lines.push('{');

  // subscriptionNotification 분기: input2 스타일 순서
  if (origin.subscriptionNotification) {
    const input2Order = [
      'msgVersion',
      'clientId',
      'eventTimeMillis',
      'subscriptionNotification',
      'environmenmt',
      'marketCode'
    ];
    for (const key of input2Order) {
      if (!Object.prototype.hasOwnProperty.call(origin, key)) continue;
      const val = origin[key];
      if (key === 'subscriptionNotification' && val && typeof val === 'object') {
        lines.push(`${ind}"${key}": {`);
        const subKeys = Object.keys(val);
        subKeys.forEach((subKey, idx) => {
          const subVal = formatValue(val[subKey], { truncateLen });
          const comma = (idx < subKeys.length - 1) ? ',' : '';
          // version, productId, notificationType, purchaseToken은 한 번 더 들여쓰기
          if (["version", "productId", "notificationType", "purchaseToken"].includes(subKey)) {
            lines.push(`${ind2}${NBSP}${NBSP}"${subKey}": ${subVal}${comma}`);
          } else {
            lines.push(`${ind2}"${subKey}": ${subVal}${comma}`);
          }
        });
        lines.push(`${ind}},`);
        continue;
      }
      const fv = formatValue(val, { truncateLen });
      const commaNeeded = key !== input2Order[input2Order.length - 1] ? ',' : '';
      lines.push(`${ind}"${key}": ${fv}${commaNeeded}`);
    }
  } else {
    // 기존 preferredOrder 방식
    const preferredOrder = [
      'msgVersion', 'clientId', 'productId', 'messageType', 'purchaseId',
      'developerPayload', 'purchaseTimeMillis', 'purchaseState',
      'price', 'priceCurrencyCode', 'productName',
      'paymentTypeList', 'billingKey', 'isTestMdn',
      'purchaseToken', 'environment', 'marketCode', 'signature'
    ];
    const keys = Object.keys(origin);
    const ordered = [
      ...preferredOrder.filter(k => keys.includes(k)),
      ...keys.filter(k => !preferredOrder.includes(k))
    ];
    for (const key of ordered) {
      const val = origin[key];
      if (key === 'paymentTypeList' && Array.isArray(val)) {
        lines.push(`${ind}"${key}": [`);
        val.forEach((item, idx) => {
          const pm = formatValue(item.paymentMethod, { truncateLen });
          const amt = formatValue(item.amount, { truncateLen });
          const comma = (idx < val.length - 1) ? ',' : '';
          lines.push(`${ind2}${NBSP}${NBSP}{ "paymentMethod": ${pm}, "amount": ${amt} }${comma}`);
        });
        lines.push(`${ind}],`);
        continue;
      }
      const fv = formatValue(val, { truncateLen });
      const commaNeeded = key !== ordered[ordered.length - 1] ? ',' : '';
      lines.push(`${ind}"${key}": ${fv}${commaNeeded}`);
    }
  }

  lines.push('}');
  return lines;
}

/**
 * 라인 배열 → Adaptive Card body
 * mode: 'textblock' (기본: 각 줄을 별도 TextBlock)
 *     | 'single'    (모든 줄을 하나의 TextBlock + \n)
 */
function linesToAdaptiveBody(lines, {
  title = 'PNS',
  version = '1.5',
  useMonospace = true,
  mode = 'textblock'
} = {}) {
  const body = [];

  // KST 시간 생성
  function getKSTTimeString() {
    const now = new Date();
    // KST: UTC+9
    const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    const yyyy = kst.getUTCFullYear();
    const mm = String(kst.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(kst.getUTCDate()).padStart(2, '0');
    const hh = String(kst.getUTCHours()).padStart(2, '0');
    const min = String(kst.getUTCMinutes()).padStart(2, '0');
    const ss = String(kst.getUTCSeconds()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd} ${hh}:${min}:${ss}`;
  }

  // RichTextBlock으로 변환
  // 제목은 첫 TextRun(bolder), 나머지는 줄마다 TextRun, 줄바꿈은 \n으로 처리
  const inlines = [];
  inlines.push({ type: 'TextRun', text: `${title} (${getKSTTimeString()})`, weight: 'bolder' });
  for (const line of lines) {
    inlines.push({ type: 'TextRun', text: `\n${line}` });
  }
  body.push({
    type: 'RichTextBlock',
    inlines
  });
  return body;
}

/**
 * 원본 → Adaptive Card 메시지(envelope)
 */
function buildAdaptiveMessage(origin, {
  indentSize = 5,
  truncateLen = 0,
  title = 'PNS',
  version = '1.5',
  useMonospace = true,
  mode = 'textblock',
  actions = []
} = {}) {
  const lines = originToPrettyLines(origin, { indentSize, truncateLen });
  const body = linesToAdaptiveBody(lines, { title, version, useMonospace, mode });

  return {
    type: 'message',
    attachments: [
      {
        contentType: 'application/vnd.microsoft.card.adaptive',
        contentUrl: null,
        content: {
          $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
          type: 'AdaptiveCard',
          version,
          msteams: { width: 'Full' },
          body
        }
      }
    ]
  };
}

/**
 * 메인 실행
 */
(function main() {
  const args = parseArgs(process.argv);
  const raw = readInput(args);
  const parsed = tryParseJSON(raw);

  // 입력이 JSON이면 파싱해서 객체로, 아니면 "원문 라인"으로 취급
  let origin;
  let opts;
  if (parsed) {
    origin = parsed;
    // subscriptionNotification 분기
    if (origin.subscriptionNotification) {
      opts = {
        indentSize: Number(args.indent || 5),
        truncateLen: Number(args.truncate || 0),
        title: args.title || 'Subscription PNS',
        version: args.version || '1.5',
        useMonospace: !args['no-mono'],
        mode: args.single ? 'single' : 'textblock'
      };
    } else {
      opts = {
        indentSize: Number(args.indent || 5),
        truncateLen: Number(args.truncate || 0),
        title: args.title || 'PNS',
        version: args.version || '1.5',
        useMonospace: !args['no-mono'],
        mode: args.single ? 'single' : 'textblock'
      };
    }
  } else {
    // JSON이 아니라면 라인별 문자열로 받아 JSON처럼 출력 (간단 래핑)
    const lines = raw.split(/\r?\n/).filter(l => l.trim().length > 0);
    // 라인들을 키:값 형태로 매핑 시도 (아니면 원문 그대로 보여주기)
    origin = {};
    for (const line of lines) {
      const m = line.match(/^\s*"?([\w.-]+)"?\s*:\s*(.+?)\s*$/);
      if (m) {
        const k = m[1];
        let v = m[2].replace(/,$/, '');
        // 숫자/불리언으로 캐스팅 시도
        if (/^(true|false)$/i.test(v)) v = v.toLowerCase() === 'true';
        else if (/^\d+(\.\d+)?$/.test(v)) v = Number(v);
        else v = v.replace(/^"|"$/g, '');
        origin[k] = v;
      } else {
        // 매핑 실패 시 원문 라인을 누적해 보여줌
        origin['raw'] = (origin['raw'] || []).concat(line);
      }
    }
    opts = {
      indentSize: Number(args.indent || 5),
      truncateLen: Number(args.truncate || 0),
      title: args.title || 'PNS',
      version: args.version || '1.5',
      useMonospace: !args['no-mono'],
      mode: args.single ? 'single' : 'textblock'
    };
  }

  const adaptiveMessage = buildAdaptiveMessage(origin, opts);
  process.stdout.write(JSON.stringify(adaptiveMessage, null, 2));
})();

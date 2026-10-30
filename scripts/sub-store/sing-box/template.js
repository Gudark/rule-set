/**
 * Sing-box 模板节点填充脚本（占位符平铺 + default 智能随机替换）
 */

// 1. 获取传入参数
let { type, name } = $arguments || {};
if (!name) {
  name = "你的订阅名称"; // 备用订阅名称
}

const subType = /^1$|col|组合/i.test(type) ? 'collection' : 'subscription';
const parser = (typeof ProxyUtils !== 'undefined' && ProxyUtils.JSON5) ? ProxyUtils.JSON5 : JSON;

// 解析模板 JSON
let config;
try {
  config = parser.parse($content ?? $files[0]);
} catch (e) {
  throw new Error(`配置文件非合法 JSON/JSON5 格式: ${e.message}`);
}

// 2. 读取节点数据
const dataRaw = await produceArtifact({
  name,
  type: subType,
  platform: 'sing-box',
});

const data = JSON.parse(dataRaw);
const nodeOutbounds = data.outbounds ?? [];
const nodeEndpoints = data.endpoints ?? [];
const allNodes = [...nodeOutbounds, ...nodeEndpoints];
const allNodeTags = allNodes.map((p) => p.tag);

if (!Array.isArray(config.outbounds)) {
  config.outbounds = [];
}

// 常见国家/地区的关键字正则表
const regionRegexMap = {
  '香港': /(?:🇭🇰|HK|hk|香港|港|HongKong)/i,
  '日本': /(?:🇯🇵|JP|jp|日本|日|Japan)/i,
  '美国': /(?:🇺🇸|US|us|美国|美|United\s*States)/i,
  '新加坡': /(?:🇸🇬|SG|sg|新加坡|坡|狮城|Singapore)/i,
  '台湾': /(?:🇹🇼|TW|tw|台湾|台|Taiwan)/i,
  '韩国': /(?:🇰🇷|KR|kr|韩国|韩|Korea)/i,
  '英国': /(?:🇬🇧|UK|uk|英国|英|United\s*Kingdom)/i,
  '德国': /(?:🇩🇪|DE|de|德国|德|Germany)/i,
};

// 辅助函数：根据关键字从已有节点中匹配，若有多个则随机选一个
function matchDefaultNode(keyword, availableNodes) {
  if (!keyword || !availableNodes || availableNodes.length === 0) return null;
  const regex = regionRegexMap[keyword] || new RegExp(keyword, 'i');
  const matched = availableNodes.filter((tag) => regex.test(tag));

  if (matched.length > 0) {
    const randomIndex = Math.floor(Math.random() * matched.length);
    return matched[randomIndex];
  }
  return null;
}

// 匹配占位符的正则：兼容 "[all]"、"{all}"、"<all>" 或 "all"
const placeholderRegex = /^(?:\[all\]|\{all\}|<all>|all)$/i;

// 3. 遍历模板策略组：平铺展开占位符并处理 default
config.outbounds.forEach((outbound) => {
  // 仅对包含 outbounds 数组的策略组处理
  if (Array.isArray(outbound.outbounds)) {
    // ----------------------------------------------------
    // 核心 1：将 [all] 原地平铺展开为所有真实自建节点
    // ----------------------------------------------------
    outbound.outbounds = outbound.outbounds.flatMap((item) => {
      if (typeof item === 'string' && placeholderRegex.test(item.trim())) {
        return allNodeTags; // 遇到占位符，直接展开所有节点
      }
      return item; // 普通项（如 "手动选择"、"直连"）保持原位置不变
    });

    // ----------------------------------------------------
    // 核心 2：处理 "default" 默认出站匹配与随机替换
    // ----------------------------------------------------
    if (outbound.default && (outbound.type === 'selector' || outbound.type === 'urltest')) {
      const selectedNode = matchDefaultNode(outbound.default, outbound.outbounds);

      if (selectedNode) {
        outbound.default = selectedNode;
      } else {
        // 若未匹配到对应国家节点，降级为该组第 1 项，防止 sing-box 启动报错
        if (outbound.outbounds.length > 0) {
          outbound.default = outbound.outbounds[0];
        } else {
          delete outbound.default;
        }
      }
    }
  }
});

// 4. 将实际节点配置追加到 outbounds 和 endpoints
config.outbounds.push(...nodeOutbounds);

if (nodeEndpoints.length > 0) {
  if (!Array.isArray(config.endpoints)) {
    config.endpoints = [];
  }
  config.endpoints.push(...nodeEndpoints);
}

// 输出最终配置
$content = JSON.stringify(config, null, 2);
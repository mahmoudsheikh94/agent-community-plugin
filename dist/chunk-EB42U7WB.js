#!/usr/bin/env node

// src/ingest/transformer/html-to-text.ts
function htmlToText(html) {
  let text = html;
  text = text.replace(
    /<pre[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi,
    (_, code) => `
\`\`\`
${decodeEntities(code).trim()}
\`\`\`
`
  );
  text = text.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (_, code) => `\`${decodeEntities(code)}\``);
  text = text.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, content) => {
    const inner = htmlToText(content).trim();
    return inner.split("\n").map((line) => `> ${line}`).join("\n") + "\n";
  });
  text = text.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, content) => `- ${htmlToText(content).trim()}
`);
  text = text.replace(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi, (_, content) => `
${htmlToText(content).trim()}
`);
  text = text.replace(/<\/(?:p|div|br\s*\/?)>/gi, "\n");
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<a[^>]*>([\s\S]*?)<\/a>/gi, (_, content) => htmlToText(content));
  text = text.replace(/<img[^>]*alt="([^"]*)"[^>]*>/gi, (_, alt) => alt);
  text = text.replace(/<img[^>]*>/gi, "");
  text = text.replace(/<[^>]+>/g, "");
  text = decodeEntities(text);
  text = text.replace(/\n{3,}/g, "\n\n");
  return text.trim();
}
function decodeEntities(text) {
  return text.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'").replace(/&#x2F;/g, "/").replace(/&#(\d+);/g, (_, num) => String.fromCharCode(parseInt(num, 10))).replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

export {
  htmlToText
};

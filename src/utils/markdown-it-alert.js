const ALERT_TYPES = ["NOTE", "TIP", "IMPORTANT", "WARNING", "CAUTION"];
const ALERT_PATTERN = new RegExp(`^\\[!(${ALERT_TYPES.join("|")})\\](?:[ \\t]+|$)`, "i");

function markdownItAlert(md) {
  md.core.ruler.after("inline", "alert", (state) => {
    const {tokens} = state;

    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i].type !== "blockquote_open") continue;

      const inlineToken = tokens[i + 2];
      if (!inlineToken || inlineToken.type !== "inline" || !inlineToken.children || !inlineToken.children.length) {
        continue;
      }

      const firstChild = inlineToken.children[0];
      if (firstChild.type !== "text") continue;

      const match = firstChild.content.match(ALERT_PATTERN);
      if (!match) continue;

      const type = match[1].toUpperCase();
      tokens[i].attrJoin("class", `markdown-alert markdown-alert-${type.toLowerCase()}`);

      const title = new state.Token("html_inline", "", 0);
      title.content = `<strong class="markdown-alert-title">${type}</strong>`;
      firstChild.content = firstChild.content.slice(match[0].length);
      inlineToken.children.unshift(title);
    }
  });
}

module.exports = markdownItAlert;

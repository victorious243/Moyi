const MarkdownIt = require('markdown-it');

const markdown = new MarkdownIt({
  breaks: true,
  html: false,
  linkify: true,
  typographer: false
});

function renderContentBody(body) {
  return markdown.render(String(body || ''));
}

module.exports = {
  renderContentBody
};

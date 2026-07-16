import SupportKnowledgeArticle from "../models/supportKnowledgeArticle.js";

const tokenize = (value) =>
  String(value || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3);

export const findRelevantSupportKnowledge = async ({ subject, messages, limit = 5 }) => {
  const queryText = [subject, ...messages.slice(-8).map((message) => message.body)].join(" ");
  const queryTokens = new Set(tokenize(queryText));

  const articles = await SupportKnowledgeArticle.find({ isActive: true })
    .sort({ updatedAt: -1 })
    .lean();

  return articles
    .map((article) => {
      const articleTokens = tokenize([
        article.title,
        article.category,
        article.content,
        ...(article.keywords || []),
      ].join(" "));
      const score = articleTokens.reduce(
        (total, token) => total + (queryTokens.has(token) ? 1 : 0),
        0
      );
      return { ...article, score };
    })
    .filter((article) => article.score > 0)
    .sort((a, b) => b.score - a.score || new Date(b.updatedAt) - new Date(a.updatedAt))
    .slice(0, limit)
    .map((article) => ({
      title: article.title,
      category: article.category,
      content: article.content,
    }));
};

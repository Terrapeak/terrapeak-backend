import SupportKnowledgeArticle from "../models/supportKnowledgeArticle.js";

const tokenize = (value) =>
  String(value || "")
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);

export const buildSupportKnowledgeContext = async ({ subject, messages, category }) => {
  const transcript = messages
    .slice(-12)
    .map((message) => message.body)
    .join(" ");
  const tokens = new Set([...tokenize(subject), ...tokenize(transcript)]);

  const articles = await SupportKnowledgeArticle.find({ isActive: true })
    .sort({ updatedAt: -1 })
    .limit(40)
    .lean();

  const scored = articles.map((article) => {
    let score = 0;
    if (article.category === category) score += 8;
    if (article.category === "general") score += 2;

    const searchable = [article.title, article.content, ...(article.keywords || [])]
      .join(" ")
      .toLowerCase();

    tokens.forEach((token) => {
      if (searchable.includes(token)) score += 1;
    });

    return { article, score };
  });

  return scored
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6)
    .map(({ article }) => ({
      title: article.title,
      category: article.category,
      content: article.content,
    }));
};

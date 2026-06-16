// utils/cache.js
import NodeCache from "node-cache";
export const chatbotCache = 
new NodeCache
({ stdTTL: 300 }); // cache for 5 minutes

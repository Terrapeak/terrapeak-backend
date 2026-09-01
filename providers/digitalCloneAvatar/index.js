import HeyGenAvatarProvider from "./heyGenAvatarProvider.js";
import MockAvatarProvider from "./mockAvatarProvider.js";
const factories = new Map([["heygen", () => new HeyGenAvatarProvider()]]);
const unavailable = () => { const error = new Error("TerraPeak Avatar is not configured."); error.code = "AVATAR_PROVIDER_NOT_CONFIGURED"; error.statusCode = 503; return error; };
export const registerAvatarProvider = (name, factory) => { if (!name || typeof factory !== "function") throw new Error("An avatar provider name and factory are required."); factories.set(name, factory); };
export const resolveAvatarProvider = (name = process.env.DIGITAL_CLONE_AVATAR_PROVIDER || "") => { if (name === "mock") throw unavailable(); const factory = factories.get(name); if (!factory) throw unavailable(); const provider = factory(); provider.assertConfigured?.(); return provider; };
export { HeyGenAvatarProvider, MockAvatarProvider };

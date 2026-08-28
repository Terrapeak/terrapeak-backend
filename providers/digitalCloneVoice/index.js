import ChatterboxVoiceProvider from "./chatterboxVoiceProvider.js";
import ElevenLabsVoiceProvider from "./elevenLabsVoiceProvider.js";
import MockVoiceProvider from "./mockVoiceProvider.js";

const factories = new Map([
  ["chatterbox", () => new ChatterboxVoiceProvider()],
  ["elevenlabs", () => new ElevenLabsVoiceProvider()],
]);

const notConfigured = () => {
  const error = new Error("The configured TerraPeak Voice provider is unavailable.");
  error.statusCode = 503;
  error.code = "VOICE_PROVIDER_NOT_CONFIGURED";
  return error;
};

export const registerVoiceProvider = (name, factory) => {
  if (!name || typeof factory !== "function") throw new Error("A voice provider name and factory are required.");
  factories.set(name, factory);
};

export const resolveVoiceProvider = (name = process.env.DIGITAL_CLONE_VOICE_PROVIDER || "") => {
  if (name === "mock") throw notConfigured();
  const factory = factories.get(name);
  if (!factory) throw notConfigured();
  return factory();
};

export { ChatterboxVoiceProvider, ElevenLabsVoiceProvider, MockVoiceProvider };

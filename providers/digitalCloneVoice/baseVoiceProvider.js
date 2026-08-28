export default class BaseVoiceProvider {
  constructor({ name }) {
    this.name = name;
  }

  async createVoice() {
    throw new Error("createVoice must be implemented by a voice provider.");
  }

  async generateSpeech() {
    throw new Error("generateSpeech must be implemented by a voice provider.");
  }

  async getStatus() {
    throw new Error("getStatus must be implemented by a voice provider.");
  }

  async deleteVoice() {
    throw new Error("deleteVoice must be implemented by a voice provider.");
  }
}

export default class BaseAvatarProvider {
  constructor({ name }) { this.name = name; }
  async listAvatars() { throw new Error("listAvatars must be implemented by an avatar provider."); }
  async getAvatar() { throw new Error("getAvatar must be implemented by an avatar provider."); }
  async createVideo() { throw new Error("createVideo must be implemented by an avatar provider."); }
  async getVideoStatus() { throw new Error("getVideoStatus must be implemented by an avatar provider."); }
  async deleteGeneratedVideo() { return { deleted: false }; }
}

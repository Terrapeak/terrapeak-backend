import axios from "axios";
import jwt from "jsonwebtoken";

const STATE_ISSUER = "terrapeak";
const STATE_AUDIENCE = "facebook-channel-oauth";
const DEFAULT_SCOPES = ["pages_show_list", "pages_manage_metadata", "pages_messaging"];

const getQueryString = (value) => {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return "";
};

const requireEnvironmentVariable = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
};

const getMetaConfig = () => {
  const graphVersion = requireEnvironmentVariable("META_GRAPH_API_VERSION");
  if (!/^v\d+\.\d+$/.test(graphVersion)) {
    throw new Error("META_GRAPH_API_VERSION must use a value such as v24.0.");
  }
  return {
    appId: requireEnvironmentVariable("META_APP_ID"),
    appSecret: requireEnvironmentVariable("META_APP_SECRET"),
    graphVersion,
    redirectUri: require
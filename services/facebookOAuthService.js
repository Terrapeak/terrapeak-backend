import axios from "axios";
import jwt from "jsonwebtoken";

const STATE_ISSUER = "terrapeak";
const STATE_AUDIENCE = "facebook-channel-oauth";
const DEFAULT_SCOPES = ["pages_show_list", "pages_manage_metadata", "pages_messaging"];

const getQueryString = (value) => typeof value === "string" ? value : Array.isArray(value) && typeof value[0] === "string" ? value[0] : "
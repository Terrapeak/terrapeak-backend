import mongoose from "mongoose";
import { v2 as cloudinary } from "cloudinary";
import ContentStudioContent from "../../models/contentStudioContent.js";
import ContentStudioImageAsset from "../../models/contentStudioImageAsset.js";
import { validateCompanyImages } from "./imageOwnershipService.js";
import { recordImageAudit } from "./imageAuditService.js";

const makeError = (message, statusCode = 400, code = "") => {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (code) error.code = code;
  return error;
};

const configureCloudinary = () => {
  const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } = process.env;
  if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) {
    throw makeError("Image storage is not configured.", 503, "IMAGE_STORAGE_NOT_CONFIGURED");
  }
  cloudinary.config({
    cloud_name: CLOUDINARY_CLOUD_NAME,
    api_key: CLOUDINARY_API_KEY,
    api_secret: CLOUDINARY_API_SECRET,
    secure: true,
  });
};

const uniqueAssetIds = (content) =>
  [...new Set((content.images || []).map((image) => String(image.assetId)).filter(Boolean))];

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const buildPublishedContent = ({ content, assets }) => {
  let published = String(content || "");
  for (const asset of assets) {
    if (!asset.publishedUrl) {
      throw makeError(
        "Every attached image must have a public rendition before publication.",
        409,
        "PUBLIC_RENDITION_MISSING",
      );
    }
    const assetId = String(asset._id);
    published = published.replace(
      new RegExp(`asset:${escapeRegExp(assetId)}`, "gi"),
      asset.publishedUrl,
    );
  }
  return published;
};

const createPublicRendition = async ({ companyId, asset }) => {
  configureCloudinary();
  const sourceUrl = cloudinary.url(asset.storagePublicId, {
    resource_type: "image",
    type: asset.deliveryType || "authenticated",
    secure: true,
    sign_url: asset.deliveryType === "authenticated",
  });
  return cloudinary.uploader.upload(sourceUrl, {
    folder: `terrapeak/content-studio-published/${companyId}`,
    public_id: `asset-${asset._id}`,
    resource_type: "image",
    type: "upload",
    overwrite: false,
  });
};

const destroyPublicRendition = async (publicId) => {
  if (!publicId) return;
  configureCloudinary();
  await cloudinary.uploader.destroy(publicId, {
    resource_type: "image",
    type: "upload",
    invalidate: true,
  });
};

export const publishContent = async ({ companyId, userId, contentId }) => {
  if (!mongoose.Types.ObjectId.isValid(contentId)) {
    throw makeError("A valid content ID is required.");
  }
  const content = await ContentStudioContent.findOne({ _id: contentId, companyId });
  if (!content) return null;

  const assetIds = uniqueAssetIds(content);
  await validateCompanyImages({
    companyId,
    userId,
    assetIds,
    action: "publish",
  });

  const assets = assetIds.length
    ? await ContentStudioImageAsset.find({
        _id: { $in: assetIds },
        companyId,
        status: "active",
      })
    : [];

  if (assets.length !== assetIds.length) {
    throw makeErroЉђ[€]XЪY[XYЩHШ\И›Э›Э[™€‹’SPQСWУ“ХС“ХS‘ЉNВ€B‚€ЫЫњЭЬ™X]Y™[™][ЫњИHЧNВ€ћHВ€›Ь€
ЫЫњЭ\ЬЩ]Щ€\ЬЩ]КHВ€Y€
\ЬЩ]њX›\ЪY\›	‰€\ЬЩ]њX›\ЪYЭЬYЩTX›XТY
HЫЫќ[ќYNВ€ЫЫњЭ\ШYH]ШZ]Ь™X]TX›XФ™[™][ЫЉИЫЫ\[ћRY\ЬЩ]JNВ€\ЬЩ]њX›\ЪY\›H\ШYњЩXЭ\™WЭ\›В€\ЬЩ]њX›\ЪYЭЬYЩTX›XТYH\ШYњX›XЧЪYВ€\ЬЩ]њX›\ЪYћ]\ИHX]›X^
ќ[X™\Љ\ШYћ]\КHќ[X™\Љ\ЬЩ]ћ]\КH
NВ€\ЬЩ]њX›\ЪY]H™]И]J
NВ€\ЬЩ]њX›\ЪYћU\Щ\’YH\Щ\’YВ€\ЬЩ]ќљ\ЪXљ[]HHњX›\ЪY\X›XИЋВ€Ь™X]Y™[™][ЫњЛњ\Ъ
И\ЬЩ]X›XТY€\ШYњX›XЧЪYJNВ€B‚€ЫЫњЭX›\ЪYЫЫќ[ќHќZ[X›\ЪYЫЫќ[ќ
ИЫЫќ[ќ€ЫЫќ[ќЫЫќ[ќ\ЬЩ]ИJNВ€ЫЫњЭЩ\ЬЪ[Ы€H]ШZ][Ы™ЫЫЬЩKњЭ\ќЩ\ЬЪ[ЫЉ
NВ€ћHВ€]ШZ]Щ\ЬЪ[Ы‹ќЪ][њШXЭ[ЫЉ\Ю[И

HO€В€›Ь€
ЫЫњЭИ\ЬЩ]HЩ€Ь™X]Y™[™][ЫњКHВ€]ШZ]\ЬЩ]њШ]™JИЩ\ЬЪ[Ы€JNВ€]ШZ]™XЫЬ™[XYЩP]Y]
В€ЫЫ\[ћRY€\Щ\’Y€[XYЩRY€\ЬЩ]—ЪY€]™[ќ\N€љ[XYЩKњX›\ЪY‹€ЫЭ\ЩN€\ЬЩ]њЫЭ\ЩK€›ЭљY\Ћ€\ЬЩ]њ›ЭљY\‹€љ[TЪ^™N€\ЬЩ]њX›\ЪYћ]\Л€ЩXЭ\™SY]Y]N€ИЫЫќ[ќY€Эљ[™КЫЫќ[ќ—ЪY
HK€Щ\ЬЪ[Ы‹€JNВ€B€ЫЫќ[ќњX›\ЪYЫЫќ[ќHX›\ЪYЫЫќ[ќВ€ЫЫќ[ќњX›\ЪY]H™]И]J
NВ€ЫЫќ[ќњX›\ЪYћU\Щ\’YH\Щ\’YВ€ЫЫќ[ќњX›\Ъ™\њЪ[Ы€H
ЫЫќ[ќњX›\Ъ™\њЪ[Ы€
H
ИNВ€ЫЫќ[ќњЭ]\ИH™љ[[ЋВ€ЫЫќ[ќ›\ЭY]YћU\Щ\’YH\Щ\’YВ€]ШZ]ЫЫќ[ќњШ]™JИЩ\ЬЪ[Ы€JNВ€JNВ€Hљ[[HВ€]ШZ]Щ\ЬЪ[Ы‹™[™Щ\ЬЪ[ЫЉ
NВ€B€™]\›€В€ЫЫќ[ќ€ЫЫќ[ќќУШљ™XЭ

K€X›\ЪYЭЬYЩPћ]\О€Ь™X]Y™[™][ЫњЛњ™YXЩJ€
Э[][JHO€Э[
ИX]›X^
ќ[X™\Љ][K\ЬЩ]њX›\ЪYћ]\КH
K€€
K€NВ€HШ]Ъ
\њ›ЬЉHВ€]ШZ]›ЫZ\ЩK[Щ]Y
€Ь™X]Y™[™][ЫњЛ›X\

ИX›XТYJHO€\Э›ЮTX›XФ™[™][ЫЉX›XТY
JK€
NВ€›ЭИ\њ›ЬЋВ€BџNВ‚™^ЬќЫЫњЭЩ]X›\ЪYЫЫќ[ќH\Ю[И
ИЫЫ\[ћRYЫЫќ[ќYJHO€В€Y€
[[Ы™ЫЫЬЩK•\\Л“Шљ™XЭYљ\Х[Y
ЫЫќ[ќY
JH™]\›€ќ[В€ЫЫњЭЫЫќ[ќH]ШZ]ЫЫќ[ќЭY[РЫЫќ[ќ™љ[™Ы™JИЪY€ЫЫќ[ќYЫЫ\[ћRYJK›X[Љ
NВ€Y€
XЫЫќ[ќЛњX›\ЪY]XЫЫќ[ќњX›\ЪYЫЫќ[ќ
H™]\›€ќ[В€™]\›€В€Y€ЫЫќ[ќ—ЪY€]N€ЫЫќ[ќќ]K€ЫЫќ[ќ\N€ЫЫќ[ќЫЫќ[ќ\K€X›\ЪYЫЫќ[ќ€ЫЫќ[ќњX›\ЪYЫЫќ[ќ€X›\ЪY]€ЫЫќ[ќњX›\ЪY]€X›\Ъ™\њЪ[ЫЋ€ЫЫќ[ќњX›\Ъ™\њЪ[Ы‹€NВџNВ
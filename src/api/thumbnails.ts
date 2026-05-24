import { getBearerToken, validateJWT } from "../auth";
import { respondWithJSON } from "./json";
import { getVideo, updateVideo } from "../db/videos";
import type { ApiConfig } from "../config";
import type { BunRequest } from "bun";
import { BadRequestError, NotFoundError, UserForbiddenError } from "./errors";
import { randomBytes } from "crypto";

type Thumbnail = {
  data: ArrayBuffer;
  mediaType: string;
};

// const videoThumbnails: Map<string, Thumbnail> = new Map();

// export async function handlerGetThumbnail(cfg: ApiConfig, req: BunRequest) {
//   const { videoId } = req.params as { videoId?: string };
//   if (!videoId) {
//     throw new BadRequestError("Invalid video ID");
//   }

//   const video = getVideo(cfg.db, videoId);
//   if (!video) {
//     throw new NotFoundError("Couldn't find video");
//   }

//   const thumbnail = videoThumbnails.get(videoId);
//   const thumbnail = video.thumbnailURL
//   if (!thumbnail) {
//     throw new NotFoundError("Thumbnail not found");
//   }

//   return new Response(thumbnail.data, {
//     headers: {
//       "Content-Type": thumbnail.mediaType,
//       "Cache-Control": "no-store",
//     },
//   });
// }

export async function handlerUploadThumbnail(cfg: ApiConfig, req: BunRequest) {
  const { videoId } = req.params as { videoId?: string };
  if (!videoId) {
    throw new BadRequestError("Invalid video ID");
  }

  const token = getBearerToken(req.headers);
  const userID = validateJWT(token, cfg.jwtSecret);

  console.log("uploading thumbnail for video", videoId, "by user", userID);
  

  const formdata = await req.formData();
  const thumbnailFormdata = formdata.get("thumbnail");
  if (!(thumbnailFormdata instanceof File)) {
    throw new BadRequestError("thumbnail is not an instanc of file");
  } 

  const MAX_UPLOAD_SIZE = 10 << 20;
  if (thumbnailFormdata.size > MAX_UPLOAD_SIZE) {
    throw new BadRequestError("thumbnail is greater then 10mb");
  }
  
  const videoMeta = await getVideo(cfg.db, videoId);
  if (videoMeta == undefined) {
    throw new BadRequestError("video does not exist");

  } else if (videoMeta.userID !== userID) {
    throw new UserForbiddenError("you cant upload thumbnail to another persons thumbnail");
  }

  const isImage = (thumbnailFormdata.type == "image/jpeg" || thumbnailFormdata.type == "image/png");
  if (!isImage) {
    throw new BadRequestError("thumbnail isn't an image mime type");
  }

  const arrayBuffer = await thumbnailFormdata.arrayBuffer()
  const filename = randomBytes(32).toString("base64url") + thumbnailFormdata.type.split("/")[1];
  const fileUrl = `${cfg.assetsRoot}/${filename}`;
  videoMeta.thumbnailURL = `http://localhost:${cfg.port}/assets/${filename}`;
  
  Bun.write(fileUrl, arrayBuffer);
  updateVideo(cfg.db, videoMeta);


  return respondWithJSON(200, videoMeta);
}

import { v2 as cloudinary } from "cloudinary";

export interface Diff {
  rooms: {
    added: { id: string | number }[];
    deleted: { id: string | number }[];
    updated: Record<string, any>;
  };
  labels: {
    added: { id: string | number; areaId: string | number }[];
    deleted: { id: string | number; areaId: string | number }[];
    updated: Record<string, any>;
  };
  areas: {
    added: { id: string | number; name: string }[];
    deleted: { id: string | number; name: string }[];
    updated: Record<string, any>;
  };
  map: Record<string, any>;
}

export default async (
  diff: Diff,
  repo: string,
  pr: number,
  cloud_name: string,
  api_key: string,
  api_secret: string
): Promise<Record<string, string>> => {
  cloudinary.config({
    cloud_name: cloud_name,
    api_key: api_key,
    api_secret: api_secret,
  });
  const images: Record<string, string> = {};

  const upload = async (id: string | number, file: string, status: string) => {
    try {
      const result = await cloudinary.uploader.upload(`diff/${file}`, {
        folder: `mudlet map diff/${repo}/pr ${pr}`,
        resource_type: "auto",
      });
      images[`${id}_${status}`] = result.secure_url || result.url;
    } catch (e: any) {
      console.error(`Failed to upload ${file}: ${e.message}`);
    }
  };

  const promises: Promise<void>[] = [];

  // Rooms
  diff.rooms.added.forEach((room) =>
    promises.push(upload(room.id, `room_${room.id}_added.svg`, "added"))
  );
  diff.rooms.deleted.forEach((room) =>
    promises.push(upload(room.id, `room_${room.id}_deleted.svg`, "deleted"))
  );
  Object.keys(diff.rooms.updated).forEach((roomId) =>
    promises.push(upload(roomId, `room_${roomId}_updated.svg`, "updated"))
  );

  // Labels
  diff.labels.added.forEach((label) =>
    promises.push(
      upload(
        `${label.areaId}_${label.id}`,
        `label_${label.areaId}_${label.id}_added.svg`,
        "added_label"
      )
    )
  );
  diff.labels.deleted.forEach((label) =>
    promises.push(
      upload(
        `${label.areaId}_${label.id}`,
        `label_${label.areaId}_${label.id}_deleted.svg`,
        "deleted_label"
      )
    )
  );
  Object.keys(diff.labels.updated).forEach((compositeId) => {
    const [areaId, labelId] = compositeId.split("-");
    promises.push(
      upload(
        `${areaId}_${labelId}`,
        `label_${areaId}_${labelId}_updated.svg`,
        "updated_label"
      )
    );
  });

  await Promise.all(promises);

  return images;
};

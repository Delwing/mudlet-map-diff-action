const cloudinary = require("cloudinary").v2;

module.exports = async (diff, repo, pr, cloud_name, api_key, api_secret) => {
  cloudinary.config({
    cloud_name: cloud_name,
    api_key: api_key,
    api_secret: api_secret,
  });
  let images = {};
  await Promise.all(
    Object.keys(diff.changed).map(async (room) => cloudinary.uploader.upload(`diff/${room}.svg`, { folder: `mudlet map diff/${repo}/pr ${pr}` }, (error, result) => (images[room] = result.url)))
  );
  await Promise.all(diff.added.map(async (room) => cloudinary.uploader.upload(`diff/${room}.svg`, { folder: `mudlet map diff/${repo}/pr ${pr}` }, (error, result) => (images[room] = result.url))));
  await Promise.all(diff.deleted.map(async (room) => cloudinary.uploader.upload(`diff/${room}.svg`, { folder: `mudlet map diff/${repo}/pr ${pr}` }, (error, result) => (images[room] = result.url))));

  return images;
};

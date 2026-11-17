async function robloxProfile(username) {
  const lookup = await fetch("https://users.roblox.com/v1/usernames/users", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ usernames: [username], excludeBannedUsers: true })
  });
  if (!lookup.ok) throw new Error("Roblox lookup is temporarily unavailable. Try again.");
  const found = (await lookup.json()).data?.[0];
  if (!found) return null;
  const [profileResponse, avatarResponse] = await Promise.all([
    fetch("https://users.roblox.com/v1/users/" + encodeURIComponent(found.id)),
    fetch("https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=" + encodeURIComponent(found.id) + "&size=150x150&format=Png&isCircular=false")
  ]);
  if (!profileResponse.ok) throw new Error("Could not read that Roblox profile. Try again.");
  const profile = await profileResponse.json();
  const avatarData = avatarResponse.ok ? await avatarResponse.json() : {};
  return { id: String(found.id), username: profile.name || found.name, displayName: profile.displayName || found.displayName || found.name, description: String(profile.description || ""), avatarUrl: avatarData.data?.[0]?.imageUrl || "" };
}
module.exports = robloxProfile;

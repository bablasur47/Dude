import { createCanvas, loadImage, GlobalFonts, type SKRSContext2D } from "@napi-rs/canvas";

GlobalFonts.registerFromPath("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "DejaVu");
GlobalFonts.registerFromPath("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", "DejaVu");

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Discord CDN only accepts specific power-of-2 sizes; snap to the nearest valid one
function snapDiscordSize(size: number): number {
  const valid = [16, 32, 64, 128, 256, 512, 1024, 2048, 4096];
  return valid.reduce((prev, curr) =>
    Math.abs(curr - size) < Math.abs(prev - size) ? curr : prev
  );
}

async function fetchAvatar(url: string | null | undefined, size = 256): Promise<Buffer | null> {
  if (!url) return null;
  try {
    // Strip existing query params, force PNG (napi-rs/canvas handles PNG/JPEG best)
    let base = url.split("?")[0];
    if (/\.(webp|gif)$/i.test(base)) base = base.replace(/\.(webp|gif)$/i, ".png");
    const cdnSize = snapDiscordSize(size);
    const res = await fetch(`${base}?size=${cdnSize}`);
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

function drawStar(ctx: SKRSContext2D, cx: number, cy: number, spikes: number, outerR: number, innerR: number) {
  let rot = (Math.PI / 2) * 3;
  const step = Math.PI / spikes;
  ctx.beginPath();
  ctx.moveTo(cx, cy - outerR);
  for (let i = 0; i < spikes; i++) {
    ctx.lineTo(cx + Math.cos(rot) * outerR, cy + Math.sin(rot) * outerR);
    rot += step;
    ctx.lineTo(cx + Math.cos(rot) * innerR, cy + Math.sin(rot) * innerR);
    rot += step;
  }
  ctx.lineTo(cx, cy - outerR);
  ctx.closePath();
}

function roundedRect(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

function truncate(str: string, max: number): string {
  return str.length > max ? str.slice(0, max - 1) + "…" : str;
}

// cx/cy = center of avatar circle
async function drawAvatar(
  ctx: SKRSContext2D,
  url: string | null | undefined,
  cx: number,
  cy: number,
  r: number,
  glowColor: string,
  ringColor: string,
  fallbackLetter = "?"
) {
  // Soft outer glow
  ctx.save();
  const glowGrad = ctx.createRadialGradient(cx, cy, r * 0.7, cx, cy, r + 18);
  glowGrad.addColorStop(0, glowColor + "55");
  glowGrad.addColorStop(1, "transparent");
  ctx.fillStyle = glowGrad;
  ctx.beginPath();
  ctx.arc(cx, cy, r + 18, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Gradient ring
  const ringGrad = ctx.createLinearGradient(cx - r - 6, cy - r - 6, cx + r + 6, cy + r + 6);
  ringGrad.addColorStop(0, ringColor);
  ringGrad.addColorStop(0.5, "#ffffff99");
  ringGrad.addColorStop(1, ringColor);
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r + 5, 0, Math.PI * 2);
  ctx.fillStyle = ringGrad;
  ctx.shadowBlur = 14;
  ctx.shadowColor = ringColor;
  ctx.fill();
  ctx.restore();

  // Dark inner ring gap
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r + 1, 0, Math.PI * 2);
  ctx.fillStyle = "#08080f";
  ctx.fill();
  ctx.restore();

  // Avatar image clipped to circle
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();

  let drawn = false;
  if (url) {
    const buf = await fetchAvatar(url, r * 4);
    if (buf) {
      try {
        const img = await loadImage(buf);
        ctx.drawImage(img, cx - r, cy - r, r * 2, r * 2);
        drawn = true;
      } catch { /* fallback */ }
    }
  }

  if (!drawn) {
    const fbGrad = ctx.createRadialGradient(cx, cy - r * 0.2, 0, cx, cy, r);
    fbGrad.addColorStop(0, ringColor + "99");
    fbGrad.addColorStop(1, "#111122");
    ctx.fillStyle = fbGrad;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  }
  ctx.restore();

  // Fallback letter
  if (!drawn) {
    ctx.save();
    ctx.font = `bold ${Math.round(r * 0.75)}px "DejaVu"`;
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.shadowBlur = 10;
    ctx.shadowColor = ringColor;
    ctx.fillText((fallbackLetter[0] ?? "?").toUpperCase(), cx, cy);
    ctx.restore();
  }
}

// ─── Love percentage ──────────────────────────────────────────────────────────

export function calculateLovePercentage(id1: string, id2: string): number {
  const combined = [id1, id2].sort().join("");
  let h = 5381;
  for (let i = 0; i < combined.length; i++) {
    h = ((h << 5) + h) ^ combined.charCodeAt(i);
    h = h >>> 0;
  }
  return h % 101;
}

export type CardUser = { id: string; username: string; avatarUrl?: string | null };

// ─── Profile card ─────────────────────────────────────────────────────────────

export type ProfileData = {
  user: CardUser;
  messageCount: number;
  spouseName?: string | null;
  parentsCount: number;
  childrenCount: number;
};

export async function generateProfileCard(data: ProfileData): Promise<Buffer> {
  const W = 820, H = 340;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  const { user, messageCount, spouseName, parentsCount, childrenCount } = data;

  // ── Background ───────────────────────────────────────────────────────────────
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, "#0e0520");
  bg.addColorStop(0.45, "#1a0730");
  bg.addColorStop(1, "#0b051a");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Left-side accent wash
  const lw = ctx.createRadialGradient(140, H / 2, 10, 140, H / 2, 260);
  lw.addColorStop(0, "rgba(155,80,210,0.20)");
  lw.addColorStop(1, "transparent");
  ctx.fillStyle = lw;
  ctx.fillRect(0, 0, W, H);

  // Right-side pink wash
  const rw = ctx.createRadialGradient(W - 60, H / 2, 10, W - 60, H / 2, 280);
  rw.addColorStop(0, "rgba(233,30,99,0.10)");
  rw.addColorStop(1, "transparent");
  ctx.fillStyle = rw;
  ctx.fillRect(0, 0, W, H);

  // Tiny star field
  for (let i = 0; i < 100; i++) {
    const sx = (i * 193.7 + 17) % W;
    const sy = (i * 87.3 + 11) % H;
    ctx.save();
    ctx.globalAlpha = 0.05 + (i % 6) * 0.03;
    ctx.fillStyle = i % 5 === 0 ? "#ff80c0" : "#ffffff";
    ctx.beginPath();
    ctx.arc(sx, sy, i % 9 === 0 ? 1.0 : 0.45, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // ── Outer border ─────────────────────────────────────────────────────────────
  ctx.save();
  roundedRect(ctx, 8, 8, W - 16, H - 16, 20);
  const borderG = ctx.createLinearGradient(0, 0, W, H);
  borderG.addColorStop(0, "#9b59b6");
  borderG.addColorStop(0.5, "#e91e63aa");
  borderG.addColorStop(1, "#9b59b6");
  ctx.strokeStyle = borderG;
  ctx.lineWidth = 2.5;
  ctx.shadowBlur = 20;
  ctx.shadowColor = "#9b59b6";
  ctx.stroke();
  ctx.restore();

  // Inner subtle border
  ctx.save();
  roundedRect(ctx, 14, 14, W - 28, H - 28, 15);
  ctx.strokeStyle = "rgba(255,255,255,0.05)";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();

  // ── Vertical divider between avatar and stats ─────────────────────────────
  const DIV_X = 270;
  ctx.save();
  const divG = ctx.createLinearGradient(DIV_X, 30, DIV_X, H - 30);
  divG.addColorStop(0, "transparent");
  divG.addColorStop(0.3, "rgba(155,80,210,0.35)");
  divG.addColorStop(0.7, "rgba(233,30,99,0.25)");
  divG.addColorStop(1, "transparent");
  ctx.strokeStyle = divG;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(DIV_X, 30);
  ctx.lineTo(DIV_X, H - 30);
  ctx.stroke();
  ctx.restore();

  // ── Avatar (left side) ───────────────────────────────────────────────────────
  const AV_CX = 138, AV_CY = H / 2 - 12, AV_R = 90;
  await drawAvatar(ctx, user.avatarUrl, AV_CX, AV_CY, AV_R, "#ffd700", "#ffb300", user.username[0]);

  // ── Username below avatar ────────────────────────────────────────────────────
  ctx.save();
  ctx.font = `bold 15px "DejaVu"`;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillStyle = "#ffffff";
  ctx.shadowBlur = 10;
  ctx.shadowColor = "#ffd700";
  ctx.fillText(truncate(user.username, 16), AV_CX, AV_CY + AV_R + 10);
  ctx.restore();

  // ── "PROFILE" pill above avatar ──────────────────────────────────────────────
  ctx.save();
  roundedRect(ctx, AV_CX - 38, AV_CY - AV_R - 32, 76, 22, 11);
  ctx.fillStyle = "rgba(155,80,210,0.20)";
  ctx.fill();
  ctx.strokeStyle = "rgba(155,80,210,0.55)";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
  ctx.save();
  ctx.font = `bold 11px "DejaVu"`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#c084fc";
  ctx.shadowBlur = 6;
  ctx.shadowColor = "#9b59b6";
  ctx.fillText("PROFILE CARD", AV_CX, AV_CY - AV_R - 21);
  ctx.restore();

  // ── Stats (right side) ───────────────────────────────────────────────────────
  const SX = DIV_X + 30;
  const statLineH = 48;
  let sy = 55;

  // Username header (big)
  const nameG = ctx.createLinearGradient(SX, 0, SX + 400, 0);
  nameG.addColorStop(0, "#ffffff");
  nameG.addColorStop(0.6, "#e0b0ff");
  nameG.addColorStop(1, "#ff80c0");
  ctx.save();
  ctx.font = `bold 28px "DejaVu"`;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillStyle = nameG;
  ctx.shadowBlur = 14;
  ctx.shadowColor = "#9b59b6";
  ctx.fillText(truncate(user.username, 18), SX, sy);
  ctx.restore();
  sy += 38;

  // Thin separator under name
  ctx.save();
  const sepG = ctx.createLinearGradient(SX, 0, W - 30, 0);
  sepG.addColorStop(0, "#9b59b655");
  sepG.addColorStop(1, "transparent");
  ctx.strokeStyle = sepG;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(SX, sy);
  ctx.lineTo(W - 30, sy);
  ctx.stroke();
  ctx.restore();
  sy += 18;

  // Helper: draw one stat row
  const drawStat = (icon: string, label: string, value: string, color: string) => {
    // Icon pill
    ctx.save();
    roundedRect(ctx, SX, sy - 2, 28, 28, 8);
    ctx.fillStyle = color + "22";
    ctx.fill();
    ctx.strokeStyle = color + "55";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
    ctx.save();
    ctx.font = `16px "DejaVu"`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(icon, SX + 14, sy + 12);
    ctx.restore();
    // Label
    ctx.save();
    ctx.font = `11px "DejaVu"`;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillStyle = "rgba(255,255,255,0.38)";
    ctx.fillText(label.toUpperCase(), SX + 36, sy);
    ctx.restore();
    // Value
    ctx.save();
    ctx.font = `bold 15px "DejaVu"`;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillStyle = "#ffffff";
    ctx.shadowBlur = 8;
    ctx.shadowColor = color;
    ctx.fillText(value, SX + 36, sy + 12);
    ctx.restore();
  };

  // Messages
  drawStat(
    "\u{1F4AC}",
    "Messages",
    messageCount.toLocaleString("en-IN"),
    "#7289da"
  );
  sy += statLineH;

  // Relationship status
  const relStatus = spouseName
    ? `Married to ${truncate(spouseName, 14)}`
    : "Single \u{1F48B}";
  drawStat("\u{1F495}", "Status", relStatus, "#e91e63");
  sy += statLineH;

  // Family
  const familyStr =
    parentsCount === 0 && childrenCount === 0
      ? "No family yet"
      : `${parentsCount} parent${parentsCount !== 1 ? "s" : ""} \u2022 ${childrenCount} kid${childrenCount !== 1 ? "s" : ""}`;
  drawStat("\u{1F3E0}", "Family", familyStr, "#43b581");
  sy += statLineH;

  // Decorative bottom bar
  ctx.save();
  const barG = ctx.createLinearGradient(SX, 0, W - 30, 0);
  barG.addColorStop(0, "#9b59b6");
  barG.addColorStop(0.5, "#e91e63");
  barG.addColorStop(1, "#9b59b6");
  roundedRect(ctx, SX, H - 36, W - SX - 22, 4, 2);
  ctx.fillStyle = barG;
  ctx.shadowBlur = 10;
  ctx.shadowColor = "#e91e63";
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.font = `11px "DejaVu"`;
  ctx.textAlign = "right";
  ctx.textBaseline = "bottom";
  ctx.fillStyle = "rgba(255,255,255,0.22)";
  ctx.fillText("Priya Bot", W - 28, H - 20);
  ctx.restore();

  return canvas.toBuffer("image/png");
}

// ─── Ship card ────────────────────────────────────────────────────────────────

export async function generateShipCard(user1: CardUser, user2: CardUser, percentage: number): Promise<Buffer> {
  const W = 800, H = 310;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  // Rich dark purple/pink background
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, "#0d0521");
  bg.addColorStop(0.35, "#1e073d");
  bg.addColorStop(0.65, "#2d0a3a");
  bg.addColorStop(1, "#0a0d21");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Center radial glow
  const cg = ctx.createRadialGradient(W / 2, H / 2, 20, W / 2, H / 2, 220);
  cg.addColorStop(0, "rgba(233,30,99,0.18)");
  cg.addColorStop(1, "transparent");
  ctx.fillStyle = cg;
  ctx.fillRect(0, 0, W, H);

  // Star field
  for (let i = 0; i < 90; i++) {
    const sx = (i * 137.5 + 17) % W;
    const sy = (i * 89.1 + 31) % H;
    ctx.save();
    ctx.globalAlpha = 0.12 + (i % 5) * 0.06;
    ctx.fillStyle = i % 5 === 0 ? "#ff80ab" : "#ffffff";
    ctx.beginPath();
    ctx.arc(sx, sy, i % 7 === 0 ? 1.5 : 0.7, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Decorative sparkle stars
  const sparks: [number, number, number][] = [[65, 45, 6], [735, 255, 5], [125, 255, 4], [675, 52, 5], [400, 22, 7]];
  for (const [sx, sy, sr] of sparks) {
    ctx.save();
    ctx.fillStyle = "#ff80ab";
    ctx.globalAlpha = 0.55;
    ctx.shadowBlur = 10;
    ctx.shadowColor = "#e91e63";
    drawStar(ctx, sx, sy, 4, sr, sr * 0.4);
    ctx.fill();
    ctx.restore();
  }

  // Title
  ctx.save();
  ctx.font = `bold 13px "DejaVu"`;
  ctx.fillStyle = "rgba(255,255,255,0.28)";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillText("S  H  I  P  P  I  N  G", W / 2, 16);
  ctx.restore();

  // Top decorative line
  const lineGrad = ctx.createLinearGradient(100, 0, W - 100, 0);
  lineGrad.addColorStop(0, "transparent");
  lineGrad.addColorStop(0.5, "#e91e6355");
  lineGrad.addColorStop(1, "transparent");
  ctx.save();
  ctx.strokeStyle = lineGrad;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(100, 38);
  ctx.lineTo(W - 100, 38);
  ctx.stroke();
  ctx.restore();

  const AV_R = 72;
  const avCY = 160;

  await drawAvatar(ctx, user1.avatarUrl, 135, avCY, AV_R, "#e91e63", "#ff4081", user1.username[0]);
  await drawAvatar(ctx, user2.avatarUrl, W - 135, avCY, AV_R, "#e91e63", "#ff4081", user2.username[0]);

  // Dashed connector line
  ctx.save();
  ctx.strokeStyle = "rgba(233,30,99,0.2)";
  ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 7]);
  ctx.beginPath();
  ctx.moveTo(135 + AV_R + 10, avCY);
  ctx.lineTo(W - 135 - AV_R - 10, avCY);
  ctx.stroke();
  ctx.restore();

  // Percentage
  const pctColor = percentage >= 80 ? "#ff4081" : percentage >= 50 ? "#e91e63" : percentage >= 25 ? "#ab47bc" : "#7986cb";
  ctx.save();
  ctx.font = `bold 52px "DejaVu"`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.shadowBlur = 24;
  ctx.shadowColor = pctColor;
  const pctGrad = ctx.createLinearGradient(W / 2 - 70, avCY - 50, W / 2 + 70, avCY);
  pctGrad.addColorStop(0, "#ffffff");
  pctGrad.addColorStop(0.5, pctColor);
  pctGrad.addColorStop(1, "#ff80ab");
  ctx.fillStyle = pctGrad;
  ctx.fillText(`${percentage}%`, W / 2, avCY - 20);
  ctx.restore();

  // Love label
  const loveLabel =
    percentage >= 90 ? "Soulmates!" :
    percentage >= 70 ? "Perfect Match!" :
    percentage >= 50 ? "Strong Chemistry" :
    percentage >= 30 ? "Something's There..." :
    percentage >= 10 ? "Nahi Hoga Yaar" : "Bilkul Nahi!";

  ctx.save();
  ctx.font = `bold 13px "DejaVu"`;
  ctx.fillStyle = pctColor + "bb";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(loveLabel, W / 2, avCY + 10);
  ctx.restore();

  // Progress bar
  const BAR_W = 240, BAR_H = 14;
  const BAR_X = (W - BAR_W) / 2, BAR_Y = avCY + 32;

  roundedRect(ctx, BAR_X, BAR_Y, BAR_W, BAR_H, BAR_H / 2);
  ctx.fillStyle = "rgba(255,255,255,0.08)";
  ctx.fill();

  if (percentage > 0) {
    const fillW = Math.max(BAR_W * (percentage / 100), BAR_H);
    roundedRect(ctx, BAR_X, BAR_Y, fillW, BAR_H, BAR_H / 2);
    const barGrad = ctx.createLinearGradient(BAR_X, 0, BAR_X + fillW, 0);
    barGrad.addColorStop(0, "#7e57c2");
    barGrad.addColorStop(0.4, "#e91e63");
    barGrad.addColorStop(1, "#ff4081");
    ctx.save();
    ctx.shadowBlur = 12;
    ctx.shadowColor = "#e91e63";
    ctx.fillStyle = barGrad;
    ctx.fill();
    ctx.restore();
  }

  // Names
  ctx.save();
  ctx.font = `bold 17px "DejaVu"`;
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.shadowBlur = 8;
  ctx.shadowColor = "#e91e63";
  ctx.fillText(truncate(user1.username, 13), 135, avCY + AV_R + 14);
  ctx.fillText(truncate(user2.username, 13), W - 135, avCY + AV_R + 14);
  ctx.restore();

  // Bottom line
  ctx.save();
  ctx.strokeStyle = lineGrad;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(100, H - 22);
  ctx.lineTo(W - 100, H - 22);
  ctx.stroke();
  ctx.restore();

  return canvas.toBuffer("image/png");
}

// ─── Marriage card ────────────────────────────────────────────────────────────

export async function generateMarriageCard(user1: CardUser, user2: CardUser, marriedAt: Date): Promise<Buffer> {
  const W = 800, H = 370;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  // Deep crimson/gold background
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, "#120308");
  bg.addColorStop(0.3, "#240a10");
  bg.addColorStop(0.6, "#1e0808");
  bg.addColorStop(1, "#0e0205");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Gold glow corners
  for (const [gx, gy] of [[0, 0], [W, 0], [0, H], [W, H]] as [number, number][]) {
    const cg = ctx.createRadialGradient(gx, gy, 0, gx, gy, 260);
    cg.addColorStop(0, "rgba(255,215,0,0.10)");
    cg.addColorStop(1, "transparent");
    ctx.fillStyle = cg;
    ctx.fillRect(0, 0, W, H);
  }

  // Gold shimmer particles
  for (let i = 0; i < 110; i++) {
    const sx = (i * 211.3 + 50) % W;
    const sy = (i * 97.7 + 20) % H;
    ctx.save();
    ctx.globalAlpha = 0.08 + (i % 5) * 0.04;
    ctx.fillStyle = i % 3 === 0 ? "#ffd700" : i % 3 === 1 ? "#ffec8b" : "#fff8dc";
    ctx.beginPath();
    ctx.arc(sx, sy, i % 7 === 0 ? 1.8 : 0.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Outer double border
  const borderGrad = ctx.createLinearGradient(0, 0, W, H);
  borderGrad.addColorStop(0, "#ffd700");
  borderGrad.addColorStop(0.25, "#ffec8b");
  borderGrad.addColorStop(0.5, "#daa520");
  borderGrad.addColorStop(0.75, "#ffec8b");
  borderGrad.addColorStop(1, "#ffd700");

  ctx.save();
  roundedRect(ctx, 7, 7, W - 14, H - 14, 18);
  ctx.strokeStyle = borderGrad;
  ctx.lineWidth = 3;
  ctx.shadowBlur = 16;
  ctx.shadowColor = "#ffd700";
  ctx.stroke();
  ctx.restore();

  ctx.save();
  roundedRect(ctx, 13, 13, W - 26, H - 26, 14);
  ctx.strokeStyle = "#ffd70030";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();

  // Corner ornaments
  const corners: [number, number][] = [[32, 32], [W - 32, 32], [32, H - 32], [W - 32, H - 32]];
  for (const [cx, cy] of corners) {
    ctx.save();
    ctx.fillStyle = "#ffd700";
    ctx.shadowBlur = 12;
    ctx.shadowColor = "#ffd700";
    drawStar(ctx, cx, cy, 4, 9, 4);
    ctx.fill();
    ctx.restore();
  }

  // Title
  const titleGrad = ctx.createLinearGradient(W / 2 - 220, 0, W / 2 + 220, 0);
  titleGrad.addColorStop(0, "#b8860b");
  titleGrad.addColorStop(0.3, "#ffd700");
  titleGrad.addColorStop(0.6, "#ffec8b");
  titleGrad.addColorStop(1, "#b8860b");
  ctx.save();
  ctx.font = `bold 28px "DejaVu"`;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.shadowBlur = 18;
  ctx.shadowColor = "#ffd700";
  ctx.fillStyle = titleGrad;
  ctx.fillText("MARRIAGE CERTIFICATE", W / 2, 28);
  ctx.restore();

  // Subtitle tagline
  ctx.save();
  ctx.font = `13px "DejaVu"`;
  ctx.fillStyle = "rgba(255,215,0,0.45)";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillText("Forever & Always", W / 2, 62);
  ctx.restore();

  // Separator
  const sep = ctx.createLinearGradient(80, 0, W - 80, 0);
  sep.addColorStop(0, "transparent");
  sep.addColorStop(0.5, "#ffd70055");
  sep.addColorStop(1, "transparent");
  ctx.save();
  ctx.strokeStyle = sep;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(80, 86);
  ctx.lineTo(W - 80, 86);
  ctx.stroke();
  ctx.restore();

  const AV_R = 82;
  const avCY = 186;

  await drawAvatar(ctx, user1.avatarUrl, 165, avCY, AV_R, "#ffd700", "#ffec8b", user1.username[0]);
  await drawAvatar(ctx, user2.avatarUrl, W - 165, avCY, AV_R, "#ffd700", "#ffec8b", user2.username[0]);

  // Center heart
  ctx.save();
  ctx.font = `bold 44px "DejaVu"`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.shadowBlur = 28;
  ctx.shadowColor = "#e91e63";
  const hGrad = ctx.createLinearGradient(W / 2 - 30, avCY - 30, W / 2 + 30, avCY + 30);
  hGrad.addColorStop(0, "#ff80ab");
  hGrad.addColorStop(0.5, "#e91e63");
  hGrad.addColorStop(1, "#ad1457");
  ctx.fillStyle = hGrad;
  ctx.fillText("♥", W / 2, avCY - 14);
  ctx.restore();

  // "&" under heart
  ctx.save();
  ctx.font = `bold 20px "DejaVu"`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "rgba(255,215,0,0.55)";
  ctx.fillText("&", W / 2, avCY + 22);
  ctx.restore();

  // Names
  const nameGrad = ctx.createLinearGradient(0, 0, W, 0);
  nameGrad.addColorStop(0, "#ffffff");
  nameGrad.addColorStop(0.5, "#ffec8b");
  nameGrad.addColorStop(1, "#ffffff");
  ctx.save();
  ctx.font = `bold 18px "DejaVu"`;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.shadowBlur = 10;
  ctx.shadowColor = "#ffd700";
  ctx.fillStyle = nameGrad;
  ctx.fillText(truncate(user1.username, 14), 165, avCY + AV_R + 14);
  ctx.fillText(truncate(user2.username, 14), W - 165, avCY + AV_R + 14);
  ctx.restore();

  // Bottom separator
  ctx.save();
  ctx.strokeStyle = sep;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(80, H - 54);
  ctx.lineTo(W - 80, H - 54);
  ctx.stroke();
  ctx.restore();

  // Date
  const dateStr = marriedAt.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
  ctx.save();
  ctx.font = `15px "DejaVu"`;
  ctx.fillStyle = "rgba(255,215,0,0.50)";
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.fillText(`United on ${dateStr}`, W / 2, H - 22);
  ctx.restore();

  return canvas.toBuffer("image/png");
}

// ─── Adopt card ───────────────────────────────────────────────────────────────

export async function generateAdoptCard(parent: CardUser, child: CardUser): Promise<Buffer> {
  const W = 800, H = 310;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  // Deep emerald background
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, "#030f07");
  bg.addColorStop(0.4, "#071e0e");
  bg.addColorStop(0.7, "#051408");
  bg.addColorStop(1, "#021005");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Center radial glow
  const cg = ctx.createRadialGradient(W / 2, H / 2, 20, W / 2, H / 2, 230);
  cg.addColorStop(0, "rgba(67,181,129,0.14)");
  cg.addColorStop(1, "transparent");
  ctx.fillStyle = cg;
  ctx.fillRect(0, 0, W, H);

  // Sparkle particles
  for (let i = 0; i < 90; i++) {
    const sx = (i * 173.1 + 40) % W;
    const sy = (i * 113.7 + 20) % H;
    ctx.save();
    ctx.globalAlpha = 0.10 + (i % 4) * 0.05;
    ctx.fillStyle = i % 3 === 0 ? "#43b581" : i % 3 === 1 ? "#ffd700" : "#7effd4";
    ctx.beginPath();
    ctx.arc(sx, sy, i % 6 === 0 ? 1.4 : 0.7, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Ornate border
  const borderGrad = ctx.createLinearGradient(0, 0, W, H);
  borderGrad.addColorStop(0, "#43b581");
  borderGrad.addColorStop(0.3, "#7effd4");
  borderGrad.addColorStop(0.6, "#2ecc71");
  borderGrad.addColorStop(1, "#43b581");
  ctx.save();
  roundedRect(ctx, 7, 7, W - 14, H - 14, 18);
  ctx.strokeStyle = borderGrad;
  ctx.lineWidth = 2.5;
  ctx.shadowBlur = 14;
  ctx.shadowColor = "#43b581";
  ctx.stroke();
  ctx.restore();

  ctx.save();
  roundedRect(ctx, 13, 13, W - 26, H - 26, 13);
  ctx.strokeStyle = "#43b58128";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();

  // Corner stars
  const corners: [number, number][] = [[30, 30], [W - 30, 30], [30, H - 30], [W - 30, H - 30]];
  for (const [cx, cy] of corners) {
    ctx.save();
    ctx.fillStyle = "#43b581";
    ctx.shadowBlur = 8;
    ctx.shadowColor = "#43b581";
    drawStar(ctx, cx, cy, 4, 7.5, 3.2);
    ctx.fill();
    ctx.restore();
  }

  // Title
  const titleGrad = ctx.createLinearGradient(W / 2 - 200, 0, W / 2 + 200, 0);
  titleGrad.addColorStop(0, "#2ecc71");
  titleGrad.addColorStop(0.4, "#7effd4");
  titleGrad.addColorStop(0.6, "#43b581");
  titleGrad.addColorStop(1, "#2ecc71");
  ctx.save();
  ctx.font = `bold 26px "DejaVu"`;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.shadowBlur = 14;
  ctx.shadowColor = "#43b581";
  ctx.fillStyle = titleGrad;
  ctx.fillText("ADOPTION CERTIFICATE", W / 2, 24);
  ctx.restore();

  ctx.save();
  ctx.font = `13px "DejaVu"`;
  ctx.fillStyle = "rgba(67,181,129,0.45)";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillText("Welcome to the Family!", W / 2, 58);
  ctx.restore();

  // Separator
  const sep = ctx.createLinearGradient(80, 0, W - 80, 0);
  sep.addColorStop(0, "transparent");
  sep.addColorStop(0.5, "#43b58150");
  sep.addColorStop(1, "transparent");
  ctx.save();
  ctx.strokeStyle = sep;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(80, 82);
  ctx.lineTo(W - 80, 82);
  ctx.stroke();
  ctx.restore();

  const AV_R = 74;
  const avCY = 178;

  // Role badges
  const drawBadge = (label: string, bx: number, by: number, color: string) => {
    const bw = 70, bh = 20;
    ctx.save();
    roundedRect(ctx, bx - bw / 2, by, bw, bh, 10);
    ctx.fillStyle = color + "22";
    ctx.fill();
    ctx.strokeStyle = color + "66";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
    ctx.save();
    ctx.font = `bold 11px "DejaVu"`;
    ctx.fillStyle = color;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.shadowBlur = 5;
    ctx.shadowColor = color;
    ctx.fillText(label, bx, by + 10);
    ctx.restore();
  };

  drawBadge("PARENT", 155, avCY - AV_R - 28, "#43b581");
  drawBadge("CHILD", W - 155, avCY - AV_R - 28, "#ffd700");

  await drawAvatar(ctx, parent.avatarUrl, 155, avCY, AV_R, "#43b581", "#7effd4", parent.username[0]);
  await drawAvatar(ctx, child.avatarUrl, W - 155, avCY, AV_R, "#ffd700", "#ffec8b", child.username[0]);

  // Dashed connector
  ctx.save();
  ctx.strokeStyle = "rgba(67,181,129,0.22)";
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 6]);
  ctx.beginPath();
  ctx.moveTo(155 + AV_R + 10, avCY);
  ctx.lineTo(W - 155 - AV_R - 10, avCY);
  ctx.stroke();
  ctx.restore();

  // Center home icon text
  ctx.save();
  ctx.font = `bold 26px "DejaVu"`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.shadowBlur = 16;
  ctx.shadowColor = "#43b581";
  const hGrad = ctx.createLinearGradient(W / 2 - 30, avCY - 20, W / 2 + 30, avCY + 20);
  hGrad.addColorStop(0, "#7effd4");
  hGrad.addColorStop(0.5, "#43b581");
  hGrad.addColorStop(1, "#2ecc71");
  ctx.fillStyle = hGrad;
  ctx.fillText("HOME", W / 2, avCY - 12);
  ctx.restore();
  ctx.save();
  ctx.font = `14px "DejaVu"`;
  ctx.fillStyle = "rgba(67,181,129,0.55)";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("SWEET", W / 2, avCY + 14);
  ctx.restore();

  // Names
  ctx.save();
  ctx.font = `bold 17px "DejaVu"`;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.shadowBlur = 8;
  ctx.shadowColor = "#43b581";
  ctx.fillStyle = "#ffffff";
  ctx.fillText(truncate(parent.username, 13), 155, avCY + AV_R + 14);
  ctx.restore();
  ctx.save();
  ctx.font = `bold 17px "DejaVu"`;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.shadowBlur = 8;
  ctx.shadowColor = "#ffd700";
  ctx.fillStyle = "#ffffff";
  ctx.fillText(truncate(child.username, 13), W - 155, avCY + AV_R + 14);
  ctx.restore();

  // Bottom line
  ctx.save();
  ctx.strokeStyle = sep;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(80, H - 22);
  ctx.lineTo(W - 80, H - 22);
  ctx.stroke();
  ctx.restore();

  return canvas.toBuffer("image/png");
}

// ─── Family card ──────────────────────────────────────────────────────────────

export async function generateFamilyCard(
  user: CardUser,
  parents: CardUser[],
  spouse: CardUser | null,
  children: CardUser[]
): Promise<Buffer> {
  const W = 800, H = 560;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  // ── Background ──────────────────────────────────────────────────────────────
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, "#12062a");
  bg.addColorStop(0.5, "#1c0b38");
  bg.addColorStop(1, "#0e0520");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Ambient glow center
  const ag = ctx.createRadialGradient(W / 2, H / 2, 30, W / 2, H / 2, 340);
  ag.addColorStop(0, "rgba(155,80,210,0.14)");
  ag.addColorStop(1, "transparent");
  ctx.fillStyle = ag;
  ctx.fillRect(0, 0, W, H);

  // Star field
  for (let i = 0; i < 130; i++) {
    const sx = (i * 157.3 + 23) % W;
    const sy = (i * 93.7 + 11) % H;
    ctx.save();
    ctx.globalAlpha = 0.05 + (i % 7) * 0.025;
    ctx.fillStyle = i % 6 === 0 ? "#ff80c0" : "#ffffff";
    ctx.beginPath();
    ctx.arc(sx, sy, i % 9 === 0 ? 1.1 : 0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Card border
  ctx.save();
  roundedRect(ctx, 10, 10, W - 20, H - 20, 22);
  ctx.fillStyle = "rgba(255,255,255,0.025)";
  ctx.fill();
  const borderG = ctx.createLinearGradient(0, 0, W, H);
  borderG.addColorStop(0, "#9b59b6");
  borderG.addColorStop(0.5, "#e91e63aa");
  borderG.addColorStop(1, "#9b59b6");
  ctx.strokeStyle = borderG;
  ctx.lineWidth = 2.5;
  ctx.shadowBlur = 18;
  ctx.shadowColor = "#9b59b6";
  ctx.stroke();
  ctx.restore();

  // ── Title ────────────────────────────────────────────────────────────────────
  const titleG = ctx.createLinearGradient(W / 2 - 200, 0, W / 2 + 200, 0);
  titleG.addColorStop(0, "#c084fc");
  titleG.addColorStop(0.5, "#ffffff");
  titleG.addColorStop(1, "#c084fc");
  ctx.save();
  ctx.font = `bold 23px "DejaVu"`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.shadowBlur = 16;
  ctx.shadowColor = "#9b59b6";
  ctx.fillStyle = titleG;
  ctx.fillText(`${truncate(user.username, 16)}'s Family`, W / 2, 38);
  ctx.restore();

  // ── Layout constants ─────────────────────────────────────────────────────────
  const PARENT_R = 44;
  const PARENT_Y = 115;

  // User is offset left when spouse exists
  const USER_R = 60;
  const USER_X = spouse ? W / 2 - 88 : W / 2;
  const USER_Y = 295;

  const SPOUSE_R = 50;
  const SPOUSE_X = W / 2 + 92;
  const SPOUSE_Y = 295;

  const CHILD_R = 38;
  const CHILD_Y = 462;

  const PINK      = "rgba(255,110,180,0.75)";
  const PINK_DIM  = "rgba(255,110,180,0.35)";
  const PINK_GLOW = "#ff6eb4";

  // ── Helper: draw connector line ──────────────────────────────────────────────
  const drawConnector = (
    x1: number, y1: number, x2: number, y2: number,
    dashed = true, color = PINK
  ) => {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.shadowBlur = 10;
    ctx.shadowColor = PINK_GLOW;
    if (dashed) ctx.setLineDash([6, 5]);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  };

  // ── Helper: draw % + heart badge on a line midpoint ──────────────────────────
  const drawPctBadge = (mx: number, my: number, pct: number) => {
    ctx.save();
    // Small pill background
    const bw = 38, bh = 18, br = 9;
    roundedRect(ctx, mx - bw / 2, my - bh / 2, bw, bh, br);
    ctx.fillStyle = "rgba(30,10,50,0.82)";
    ctx.fill();
    ctx.strokeStyle = PINK_DIM;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
    ctx.save();
    ctx.font = `bold 10px "DejaVu"`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#ff6eb4";
    ctx.shadowBlur = 6;
    ctx.shadowColor = PINK_GLOW;
    ctx.fillText(`${pct}%`, mx, my - 2);
    ctx.restore();
    // small heart below %
    ctx.save();
    ctx.font = `9px "DejaVu"`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#ff6eb4";
    ctx.shadowBlur = 4;
    ctx.shadowColor = PINK_GLOW;
    ctx.fillText("\u2665", mx, my + 7);
    ctx.restore();
  };

  // ── Helper: draw avatar + name ───────────────────────────────────────────────
  const drawNode = async (
    u: CardUser, cx: number, cy: number, r: number,
    ringColor: string, glowColor: string,
    nameColor = "#ffffff", bold = false
  ) => {
    await drawAvatar(ctx, u.avatarUrl, cx, cy, r, glowColor, ringColor, u.username[0]);
    ctx.save();
    ctx.font = `${bold ? "bold " : ""}${bold ? 13 : 12}px "DejaVu"`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillStyle = nameColor;
    ctx.shadowBlur = bold ? 10 : 6;
    ctx.shadowColor = ringColor;
    ctx.fillText(truncate(u.username, bold ? 12 : 10), cx, cy + r + 7);
    ctx.restore();
  };

  // ── Calculate parent positions ────────────────────────────────────────────────
  const pCount = Math.min(parents.length, 4);
  const pSpacing = pCount > 1 ? Math.min(200, 660 / (pCount - 1)) : 0;
  const pStartX = W / 2 - pSpacing * (pCount - 1) / 2;
  const pXs = Array.from({ length: pCount }, (_, i) => pStartX + i * pSpacing);

  // ── Calculate children positions ──────────────────────────────────────────────
  const cCount = Math.min(children.length, 6);
  const cSpacing = cCount > 1 ? Math.min(130, 680 / (cCount - 1)) : 0;
  const cStartX = W / 2 - cSpacing * (cCount - 1) / 2;
  const cXs = Array.from({ length: cCount }, (_, i) => cStartX + i * cSpacing);

  // ═══════════════════════════════════════════════════════════════════════════
  // PASS 1 — Draw all connector lines first (behind avatars)
  // ═══════════════════════════════════════════════════════════════════════════

  // ── Parent → User lines ───────────────────────────────────────────────────────
  if (pCount > 0) {
    const RAIL_Y = PARENT_Y + PARENT_R + 22;   // horizontal rail just below parents
    const USER_TOP = USER_Y - USER_R - 4;

    // Vertical stubs from each parent down to rail
    for (const px of pXs) {
      drawConnector(px, PARENT_Y + PARENT_R + 2, px, RAIL_Y, false);
    }

    // Horizontal rail connecting all parents
    if (pCount > 1) {
      drawConnector(pXs[0], RAIL_Y, pXs[pCount - 1], RAIL_Y, false);
    }

    // Vertical line: rail center → user top
    const railCX = pCount === 1 ? pXs[0] : (pXs[0] + pXs[pCount - 1]) / 2;
    drawConnector(railCX, RAIL_Y, railCX, USER_TOP, true);

    // Merge point → user (if offset)
    if (Math.abs(railCX - USER_X) > 4) {
      drawConnector(railCX, USER_TOP, USER_X, USER_TOP, false);
      drawConnector(USER_X, USER_TOP, USER_X, USER_Y - USER_R - 2, false);
    }

    // % badge at midpoint of vertical line
    const midY = (RAIL_Y + USER_TOP) / 2;
    const avgPct = Math.round(pXs.reduce((s, _, i) => s + calculateLovePercentage(user.id, parents[i].id), 0) / pCount);
    drawPctBadge(railCX + (Math.abs(railCX - USER_X) > 4 ? 24 : 22), midY, avgPct);
  }

  // ── User ↔ Spouse line ─────────────────────────────────────────────────────
  if (spouse) {
    drawConnector(USER_X + USER_R + 3, USER_Y, SPOUSE_X - SPOUSE_R - 3, USER_Y, false);
    const marriagePct = calculateLovePercentage(user.id, spouse.id);
    drawPctBadge((USER_X + USER_R + SPOUSE_X - SPOUSE_R) / 2, USER_Y, marriagePct);
  }

  // ── User → Children lines ──────────────────────────────────────────────────
  if (cCount > 0) {
    const CRAIL_Y = CHILD_Y - CHILD_R - 22;
    const USER_BOT = USER_Y + USER_R + 4;

    // Vertical from user bottom to children rail
    drawConnector(USER_X, USER_BOT, USER_X, CRAIL_Y, true);

    // Merge if children rail center differs from user x
    const crailCX = cCount === 1 ? cXs[0] : (cXs[0] + cXs[cCount - 1]) / 2;
    if (Math.abs(crailCX - USER_X) > 4) {
      drawConnector(USER_X, CRAIL_Y, crailCX, CRAIL_Y, false);
    }

    // Horizontal rail for children
    if (cCount > 1) {
      drawConnector(cXs[0], CRAIL_Y, cXs[cCount - 1], CRAIL_Y, false);
    }

    // Vertical stubs from rail to each child
    for (let i = 0; i < cCount; i++) {
      drawConnector(cXs[i], CRAIL_Y, cXs[i], CHILD_Y - CHILD_R - 2, true);
      const pct = calculateLovePercentage(user.id, children[i].id);
      drawPctBadge(cXs[i] + 22, CRAIL_Y + (CHILD_Y - CHILD_R - CRAIL_Y) / 2, pct);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PASS 2 — Draw avatars on top of lines
  // ═══════════════════════════════════════════════════════════════════════════

  // Parents
  for (let i = 0; i < pCount; i++) {
    await drawNode(parents[i], pXs[i], PARENT_Y, PARENT_R, "#7289da", "#5865f2");
  }
  if (pCount === 0) {
    ctx.save();
    ctx.font = `13px "DejaVu"`;
    ctx.fillStyle = "rgba(255,255,255,0.20)";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("No parents", W / 2, PARENT_Y);
    ctx.restore();
  }

  // User (gold ring, bold name, larger)
  await drawNode(user, USER_X, USER_Y, USER_R, "#ffd700", "#ffb300", "#ffd700", true);

  // Spouse
  if (spouse) {
    await drawNode(spouse, SPOUSE_X, SPOUSE_Y, SPOUSE_R, "#e91e63", "#ff4081", "#ff80ab");
  }

  // Children
  for (let i = 0; i < cCount; i++) {
    await drawNode(children[i], cXs[i], CHILD_Y, CHILD_R, "#43b581", "#2ecc71");
  }
  if (cCount === 0) {
    ctx.save();
    ctx.font = `13px "DejaVu"`;
    ctx.fillStyle = "rgba(255,255,255,0.20)";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("No children", W / 2, CHILD_Y);
    ctx.restore();
  }
  if (children.length > 6) {
    ctx.save();
    ctx.font = `11px "DejaVu"`;
    ctx.fillStyle = "rgba(67,181,129,0.55)";
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillText(`+${children.length - 6} more`, W / 2, H - 14);
    ctx.restore();
  }

  return canvas.toBuffer("image/png");
}

// ─── Live Message Counter Card ────────────────────────────────────────────────

export async function generateCounterCard(opts: {
  guildName: string;
  guildIconUrl?: string;
  totalMessages: number;
  memberCount: number;
  botCount: number;
  updatedAt: Date;
}): Promise<Buffer> {
  const W = 900, H = 320;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  // Background
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, "#0a0015");
  bg.addColorStop(0.5, "#0f001f");
  bg.addColorStop(1, "#080012");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Nebula glow spots
  const spots = [
    { x: 150, y: 160, r: 220, c1: "rgba(120,0,255,0.18)", c2: "transparent" },
    { x: 750, y: 100, r: 180, c1: "rgba(0,180,255,0.14)", c2: "transparent" },
    { x: 500, y: 300, r: 160, c1: "rgba(200,0,255,0.10)", c2: "transparent" },
  ];
  for (const s of spots) {
    const g = ctx.createRadialGradient(s.x, s.y, 10, s.x, s.y, s.r);
    g.addColorStop(0, s.c1);
    g.addColorStop(1, s.c2);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  // Star particles
  for (let i = 0; i < 90; i++) {
    const sx = (i * 197.3 + 11) % W;
    const sy = (i * 113.7 + 7) % H;
    ctx.save();
    ctx.globalAlpha = 0.06 + (i % 7) * 0.05;
    ctx.fillStyle = i % 3 === 0 ? "#bf80ff" : i % 3 === 1 ? "#80cfff" : "#ffffff";
    ctx.beginPath();
    ctx.arc(sx, sy, i % 11 === 0 ? 1.4 : 0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Outer border
  ctx.save();
  roundedRect(ctx, 8, 8, W - 16, H - 16, 22);
  const borderG = ctx.createLinearGradient(0, 0, W, H);
  borderG.addColorStop(0, "#8b00ff");
  borderG.addColorStop(0.5, "#00b4ff88");
  borderG.addColorStop(1, "#8b00ff");
  ctx.strokeStyle = borderG;
  ctx.lineWidth = 2.5;
  ctx.shadowBlur = 20;
  ctx.shadowColor = "#8b00ff";
  ctx.stroke();
  ctx.restore();

  // Inner subtle border
  ctx.save();
  roundedRect(ctx, 14, 14, W - 28, H - 28, 16);
  ctx.strokeStyle = "rgba(140,0,255,0.08)";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();

  // Server icon on the left
  const ICON_CX = 120, ICON_CY = H / 2 - 10, ICON_R = 70;
  await drawAvatar(ctx, opts.guildIconUrl, ICON_CX, ICON_CY, ICON_R, "#8b00ff", "#00b4ff", opts.guildName[0]);

  // Guild name below icon
  ctx.save();
  ctx.font = `bold 13px "DejaVu"`;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillStyle = "#d4aaff";
  ctx.shadowBlur = 8;
  ctx.shadowColor = "#8b00ff";
  ctx.fillText(truncate(opts.guildName, 14), ICON_CX, ICON_CY + ICON_R + 10);
  ctx.restore();

  // Divider
  const DIV_X = 220;
  ctx.save();
  const divG = ctx.createLinearGradient(DIV_X, 30, DIV_X, H - 30);
  divG.addColorStop(0, "transparent");
  divG.addColorStop(0.3, "rgba(140,0,255,0.45)");
  divG.addColorStop(0.7, "rgba(0,180,255,0.30)");
  divG.addColorStop(1, "transparent");
  ctx.strokeStyle = divG;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(DIV_X, 30);
  ctx.lineTo(DIV_X, H - 30);
  ctx.stroke();
  ctx.restore();

  // "LIVE STATS" badge
  ctx.save();
  roundedRect(ctx, DIV_X + 20, 30, 120, 26, 13);
  ctx.fillStyle = "rgba(140,0,255,0.22)";
  ctx.fill();
  ctx.strokeStyle = "rgba(140,0,255,0.50)";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
  ctx.save();
  ctx.font = `bold 11px "DejaVu"`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#bf80ff";
  ctx.shadowBlur = 8;
  ctx.shadowColor = "#8b00ff";
  ctx.fillText("\u{1F4CA} LIVE STATS", DIV_X + 80, 43);
  ctx.restore();

  // Stats grid — two columns
  const statItems = [
    { icon: "\u{1F4AC}", label: "Total Messages", value: opts.totalMessages.toLocaleString() },
    { icon: "\u{1F465}", label: "Members", value: (opts.memberCount - opts.botCount).toLocaleString() },
    { icon: "\u{1F916}", label: "Bots", value: opts.botCount.toLocaleString() },
    { icon: "\u{1F465}", label: "Total Users", value: opts.memberCount.toLocaleString() },
  ];

  const STAT_START_X = DIV_X + 20;
  const STAT_START_Y = 78;
  const COL_W = (W - STAT_START_X - 30) / 2;
  const ROW_H = 82;

  for (let i = 0; i < statItems.length; i++) {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const bx = STAT_START_X + col * COL_W;
    const by = STAT_START_Y + row * ROW_H;

    // Card bg
    ctx.save();
    roundedRect(ctx, bx, by, COL_W - 14, ROW_H - 12, 12);
    ctx.fillStyle = "rgba(140,0,255,0.10)";
    ctx.fill();
    ctx.strokeStyle = "rgba(140,0,255,0.18)";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();

    // Icon
    ctx.save();
    ctx.font = `22px "DejaVu"`;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(statItems[i].icon, bx + 12, by + 10);
    ctx.restore();

    // Value (big)
    ctx.save();
    ctx.font = `bold 24px "DejaVu"`;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    const valG = ctx.createLinearGradient(bx + 12, 0, bx + 12 + 120, 0);
    valG.addColorStop(0, "#bf80ff");
    valG.addColorStop(1, "#80cfff");
    ctx.fillStyle = valG;
    ctx.shadowBlur = 10;
    ctx.shadowColor = "#8b00ff";
    ctx.fillText(statItems[i].value, bx + 12, by + 34);
    ctx.restore();

    // Label
    ctx.save();
    ctx.font = `11px "DejaVu"`;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillStyle = "rgba(200,180,255,0.55)";
    ctx.fillText(statItems[i].label, bx + 12, by + 58);
    ctx.restore();
  }

  // Bottom bar
  ctx.save();
  const barG = ctx.createLinearGradient(DIV_X + 20, 0, W - 22, 0);
  barG.addColorStop(0, "#8b00ff");
  barG.addColorStop(0.5, "#00b4ff");
  barG.addColorStop(1, "#8b00ff");
  roundedRect(ctx, DIV_X + 20, H - 32, W - DIV_X - 40, 3, 2);
  ctx.fillStyle = barG;
  ctx.shadowBlur = 10;
  ctx.shadowColor = "#8b00ff";
  ctx.fill();
  ctx.restore();

  // Updated at
  const updStr = opts.updatedAt.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", hour12: true });
  ctx.save();
  ctx.font = `10px "DejaVu"`;
  ctx.textAlign = "right";
  ctx.textBaseline = "bottom";
  ctx.fillStyle = "rgba(200,180,255,0.35)";
  ctx.fillText(`Updated: ${updStr} IST`, W - 24, H - 18);
  ctx.restore();

  // Priya branding
  ctx.save();
  ctx.font = `10px "DejaVu"`;
  ctx.textAlign = "left";
  ctx.textBaseline = "bottom";
  ctx.fillStyle = "rgba(200,180,255,0.35)";
  ctx.fillText("Priya Bot", DIV_X + 22, H - 18);
  ctx.restore();

  return canvas.toBuffer("image/png");
}

// ─── Shared text wrap helper ──────────────────────────────────────────────────

function wrapText(
  ctx: SKRSContext2D,
  text: string,
  x: number,
  startY: number,
  maxWidth: number,
  lineHeight: number
): number {
  const words = text.split(" ");
  let line = "";
  let y = startY;
  for (const word of words) {
    const test = line + word + " ";
    if (ctx.measureText(test).width > maxWidth && line !== "") {
      ctx.fillText(line.trim(), x, y);
      line = word + " ";
      y += lineHeight;
    } else {
      line = test;
    }
  }
  if (line.trim()) {
    ctx.fillText(line.trim(), x, y);
    y += lineHeight;
  }
  return y;
}

// ─── Roast card ───────────────────────────────────────────────────────────────

export async function generateRoastCard(target: CardUser, roastText: string): Promise<Buffer> {
  const W = 820, H = 340;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, "#0e0100");
  bg.addColorStop(0.4, "#1a0500");
  bg.addColorStop(0.7, "#200800");
  bg.addColorStop(1, "#0a0000");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  const fireGlow = ctx.createRadialGradient(W / 2, H + 60, 10, W / 2, H + 60, 380);
  fireGlow.addColorStop(0, "rgba(255,120,0,0.22)");
  fireGlow.addColorStop(0.5, "rgba(220,50,0,0.10)");
  fireGlow.addColorStop(1, "transparent");
  ctx.fillStyle = fireGlow;
  ctx.fillRect(0, 0, W, H);

  const leftGlow = ctx.createRadialGradient(150, H / 2, 10, 150, H / 2, 200);
  leftGlow.addColorStop(0, "rgba(255,60,0,0.18)");
  leftGlow.addColorStop(1, "transparent");
  ctx.fillStyle = leftGlow;
  ctx.fillRect(0, 0, W, H);

  for (let i = 0; i < 80; i++) {
    const ex = (i * 193.7 + 7) % W;
    const ey = (i * 83.1 + 13) % H;
    ctx.save();
    ctx.globalAlpha = 0.07 + (i % 6) * 0.04;
    ctx.fillStyle = i % 3 === 0 ? "#ff6600" : i % 3 === 1 ? "#ff2200" : "#ffaa00";
    ctx.beginPath();
    ctx.arc(ex, ey, i % 7 === 0 ? 1.5 : 0.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  ctx.save();
  roundedRect(ctx, 8, 8, W - 16, H - 16, 20);
  const borderG = ctx.createLinearGradient(0, 0, W, H);
  borderG.addColorStop(0, "#ff4500");
  borderG.addColorStop(0.5, "#ff8c00aa");
  borderG.addColorStop(1, "#ff4500");
  ctx.strokeStyle = borderG;
  ctx.lineWidth = 2.5;
  ctx.shadowBlur = 22;
  ctx.shadowColor = "#ff4500";
  ctx.stroke();
  ctx.restore();

  ctx.save();
  roundedRect(ctx, 14, 14, W - 28, H - 28, 15);
  ctx.strokeStyle = "rgba(255,100,0,0.08)";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();

  const DIV_X = 280;
  ctx.save();
  const divG = ctx.createLinearGradient(DIV_X, 30, DIV_X, H - 30);
  divG.addColorStop(0, "transparent");
  divG.addColorStop(0.3, "rgba(255,80,0,0.40)");
  divG.addColorStop(0.7, "rgba(255,140,0,0.30)");
  divG.addColorStop(1, "transparent");
  ctx.strokeStyle = divG;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(DIV_X, 30);
  ctx.lineTo(DIV_X, H - 30);
  ctx.stroke();
  ctx.restore();

  const AV_CX = 145, AV_CY = H / 2 - 8, AV_R = 90;

  ctx.save();
  roundedRect(ctx, AV_CX - 52, AV_CY - AV_R - 34, 104, 24, 12);
  ctx.fillStyle = "rgba(255,60,0,0.20)";
  ctx.fill();
  ctx.strokeStyle = "rgba(255,80,0,0.55)";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
  ctx.save();
  ctx.font = `bold 11px "DejaVu"`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#ff8c00";
  ctx.shadowBlur = 8;
  ctx.shadowColor = "#ff4500";
  ctx.fillText("\uD83D\uDD25 ROASTED \uD83D\uDD25", AV_CX, AV_CY - AV_R - 22);
  ctx.restore();

  await drawAvatar(ctx, target.avatarUrl, AV_CX, AV_CY, AV_R, "#ff4500", "#ff6600", target.username[0]);

  ctx.save();
  ctx.font = `bold 14px "DejaVu"`;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillStyle = "#ffffff";
  ctx.shadowBlur = 10;
  ctx.shadowColor = "#ff4500";
  ctx.fillText(truncate(target.username, 16), AV_CX, AV_CY + AV_R + 10);
  ctx.restore();

  const TX = DIV_X + 28;
  const TEXT_MAX_W = W - TX - 32;

  ctx.save();
  ctx.font = `bold 11px "DejaVu"`;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillStyle = "rgba(255,140,0,0.55)";
  ctx.fillText("THE VERDICT:", TX, 40);
  ctx.restore();

  ctx.save();
  ctx.font = `bold 48px "DejaVu"`;
  ctx.fillStyle = "rgba(255,80,0,0.14)";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText("\u201C", TX - 4, 42);
  ctx.restore();

  ctx.save();
  ctx.font = `15px "DejaVu"`;
  ctx.fillStyle = "#ffe0cc";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  wrapText(ctx, roastText, TX + 12, 72, TEXT_MAX_W, 26);
  ctx.restore();

  ctx.save();
  const barG = ctx.createLinearGradient(TX, 0, W - 22, 0);
  barG.addColorStop(0, "#ff4500");
  barG.addColorStop(0.5, "#ff8c00");
  barG.addColorStop(1, "#ff4500");
  roundedRect(ctx, TX, H - 36, W - TX - 22, 4, 2);
  ctx.fillStyle = barG;
  ctx.shadowBlur = 12;
  ctx.shadowColor = "#ff4500";
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.font = `11px "DejaVu"`;
  ctx.textAlign = "right";
  ctx.textBaseline = "bottom";
  ctx.fillStyle = "rgba(255,255,255,0.20)";
  ctx.fillText("Priya Bot", W - 28, H - 20);
  ctx.restore();

  return canvas.toBuffer("image/png");
}

// ─── Action card (hug / slap / poke / etc.) ──────────────────────────────────

export async function generateActionCard(
  from: CardUser,
  to: CardUser,
  action: string,
  emoji: string,
  color1: string,
  color2: string
): Promise<Buffer> {
  const W = 800, H = 300;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, "#08080f");
  bg.addColorStop(0.5, "#110818");
  bg.addColorStop(1, "#06060e");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  const wash = ctx.createRadialGradient(W / 2, H / 2, 20, W / 2, H / 2, 300);
  wash.addColorStop(0, color1 + "22");
  wash.addColorStop(1, "transparent");
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, W, H);

  for (let i = 0; i < 60; i++) {
    const sx = (i * 177.3 + 11) % W;
    const sy = (i * 91.7 + 7) % H;
    ctx.save();
    ctx.globalAlpha = 0.08 + (i % 5) * 0.04;
    ctx.fillStyle = i % 2 === 0 ? color1 : color2;
    ctx.beginPath();
    ctx.arc(sx, sy, i % 9 === 0 ? 1.4 : 0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  ctx.save();
  roundedRect(ctx, 8, 8, W - 16, H - 16, 18);
  const borderG = ctx.createLinearGradient(0, 0, W, H);
  borderG.addColorStop(0, color1);
  borderG.addColorStop(0.5, color2 + "aa");
  borderG.addColorStop(1, color1);
  ctx.strokeStyle = borderG;
  ctx.lineWidth = 2.5;
  ctx.shadowBlur = 18;
  ctx.shadowColor = color1;
  ctx.stroke();
  ctx.restore();

  const AV_R = 78;
  const AV_Y = H / 2;

  await drawAvatar(ctx, from.avatarUrl, 140, AV_Y, AV_R, color1, color1, from.username[0]);
  await drawAvatar(ctx, to.avatarUrl, W - 140, AV_Y, AV_R, color2, color2, to.username[0]);

  ctx.save();
  ctx.font = `bold 44px "DejaVu"`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(emoji, W / 2, AV_Y - 20);
  ctx.restore();

  ctx.save();
  ctx.font = `bold 17px "DejaVu"`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const aGrad = ctx.createLinearGradient(W / 2 - 80, 0, W / 2 + 80, 0);
  aGrad.addColorStop(0, color1);
  aGrad.addColorStop(0.5, "#ffffff");
  aGrad.addColorStop(1, color2);
  ctx.fillStyle = aGrad;
  ctx.shadowBlur = 12;
  ctx.shadowColor = color1;
  ctx.fillText(action, W / 2, AV_Y + 20);
  ctx.restore();

  ctx.save();
  ctx.font = `bold 14px "DejaVu"`;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillStyle = "#ffffff";
  ctx.shadowBlur = 6;
  ctx.shadowColor = color1;
  ctx.fillText(truncate(from.username, 12), 140, AV_Y + AV_R + 10);
  ctx.restore();

  ctx.save();
  ctx.font = `bold 14px "DejaVu"`;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillStyle = "#ffffff";
  ctx.shadowBlur = 6;
  ctx.shadowColor = color2;
  ctx.fillText(truncate(to.username, 12), W - 140, AV_Y + AV_R + 10);
  ctx.restore();

  return canvas.toBuffer("image/png");
}

"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button, Notice, ScreenHeader, SelectField, TextField } from "@/components/ui";
import { useSession } from "@/features/auth/SessionProvider";
import { saveMeal } from "@/lib/api";
import { logoutAll, updateProfile, type UpdateProfilePatch } from "@/lib/api/trustEndpoints";
import { ApiError } from "@/lib/contract/errors";
import { SELLER_TYPES, type Me, type PickupLocation, type SellerType } from "@/lib/contract/types";
import { downscaleImage } from "@/lib/image";
import { DeleteAccountSection } from "./DeleteAccountSection";
import { SELLER_TYPE_LABEL } from "./labels";
import { PwaInstallCard } from "./PwaInstallCard";
import styles from "./settings.module.css";

/**
 * Figma V1 36 · Cài đặt & PWA (`11:135`).
 * - Profile & optional seller setup (ME-2 `PATCH /me` + IMG-1 `AVATAR`)
 * - PWA install section (client-side `beforeinstallprompt` / manual instructions)
 * - Logout (AUTH-4 `POST /auth/logout` with `{ allDevices }` option)
 * - Delete account (ME-3 `DELETE /me`)
 */
export function SettingsScreen() {
  const session = useSession();
  if (session.status !== "authenticated") return null;
  return <SettingsForm me={session.me} />;
}

function SettingsForm({ me }: { me: Me }) {
  const router = useRouter();
  const session = useSession();

  const [displayName, setDisplayName] = useState(me.displayName ?? "");
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(me.avatar?.url ?? null);
  const [removeAvatar, setRemoveAvatar] = useState(false);

  const [sellerName, setSellerName] = useState(me.seller.name ?? "");
  const [sellerType, setSellerType] = useState<SellerType | "">(me.seller.type ?? "");
  const [pickupAddress, setPickupAddress] = useState(me.seller.defaultPickup?.address ?? "");
  const [pickupLat, setPickupLat] = useState(
    me.seller.defaultPickup ? String(me.seller.defaultPickup.lat) : "",
  );
  const [pickupLng, setPickupLng] = useState(
    me.seller.defaultPickup ? String(me.seller.defaultPickup.lng) : "",
  );

  const [locating, setLocating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);

  const [allDevices, setAllDevices] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const [qrBusy, setQrBusy] = useState(false);
  const [qrError, setQrError] = useState<string | null>(null);
  const [qrSuccess, setQrSuccess] = useState<string | null>(null);
  const qrInputRef = useRef<HTMLInputElement>(null);

  const objectUrlRef = useRef<string | null>(null);

  const bankQr = me.seller.bankQrImage ?? null;

  async function handleBankQrUpload(file: File | null) {
    if (!file) return;
    setQrError(null);
    setQrSuccess(null);
    setQrBusy(true);
    try {
      const blob = await downscaleImage(file);
      const uploaded = await saveMeal.uploadImage(blob, "PAYMENT_QR");
      const updated = await saveMeal.updateMe({ seller: { bankQrImageId: uploaded.id } });
      session.setMe(updated);
      await session.reloadMe().catch(() => {});
      setQrSuccess("Đã cập nhật ảnh QR ngân hàng mặc định.");
    } catch (err) {
      setQrError(err instanceof ApiError ? err.message : "Không tải được ảnh QR. Vui lòng thử lại.");
    } finally {
      setQrBusy(false);
    }
  }

  async function handleBankQrClear() {
    setQrError(null);
    setQrSuccess(null);
    setQrBusy(true);
    try {
      const updated = await saveMeal.updateMe({ seller: { bankQrImageId: null } });
      session.setMe(updated);
      await session.reloadMe().catch(() => {});
      setQrSuccess("Đã xóa ảnh QR ngân hàng mặc định.");
    } catch (err) {
      setQrError(err instanceof ApiError ? err.message : "Không xóa được ảnh QR. Vui lòng thử lại.");
    } finally {
      setQrBusy(false);
    }
  }

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    };
  }, []);

  function pickAvatar(file: File | null) {
    if (!file) return;
    setSaveError(null);
    setSaveSuccess(null);
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
      setSaveError("Chỉ hỗ trợ ảnh đại diện JPG, PNG hoặc WebP.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setSaveError("Ảnh đại diện cần nhỏ hơn 5 MB.");
      return;
    }
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    const url = URL.createObjectURL(file);
    objectUrlRef.current = url;
    setAvatarFile(file);
    setAvatarPreview(url);
    setRemoveAvatar(false);
  }

  function clearAvatar() {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    setAvatarFile(null);
    setAvatarPreview(null);
    setRemoveAvatar(true);
    setSaveSuccess(null);
  }

  function useCurrentPickupLocation() {
    if (!("geolocation" in navigator)) {
      setSaveError("Thiết bị không hỗ trợ định vị. Bạn có thể nhập tọa độ thủ công.");
      return;
    }
    setLocating(true);
    setSaveError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setPickupLat(pos.coords.latitude.toFixed(6));
        setPickupLng(pos.coords.longitude.toFixed(6));
        setLocating(false);
      },
      () => {
        setSaveError("Chưa lấy được vị trí điểm nhận. Cho phép quyền định vị hoặc nhập tọa độ.");
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }

  function clearPickup() {
    setPickupAddress("");
    setPickupLat("");
    setPickupLng("");
    setSaveSuccess(null);
  }

  async function saveProfile(e: FormEvent) {
    e.preventDefault();
    setSaveError(null);
    setSaveSuccess(null);

    const trimmedName = displayName.trim();
    if (trimmedName.length < 2 || trimmedName.length > 40) {
      setSaveError("Tên hiển thị cần từ 2 đến 40 ký tự.");
      return;
    }

    const trimmedSellerName = sellerName.trim();
    if (trimmedSellerName.length > 60) {
      setSaveError("Tên người bán tối đa 60 ký tự.");
      return;
    }

    const trimmedAddr = pickupAddress.trim();
    const hasAnyPickup = Boolean(trimmedAddr || pickupLat.trim() || pickupLng.trim());
    let defaultPickup: PickupLocation | null = null;

    if (hasAnyPickup) {
      const lat = Number(pickupLat);
      const lng = Number(pickupLng);
      if (!trimmedAddr) {
        setSaveError("Nhập địa chỉ điểm nhận mặc định hoặc xóa trống phần này.");
        return;
      }
      if (!pickupLat.trim() || !pickupLng.trim() || !Number.isFinite(lat) || !Number.isFinite(lng)) {
        setSaveError("Vui lòng ghim vị trí hoặc nhập tọa độ hợp lệ cho điểm nhận mặc định.");
        return;
      }
      defaultPickup = { address: trimmedAddr, lat, lng };
    }

    setSaving(true);
    try {
      let avatarImageId: string | null | undefined;
      if (avatarFile) {
        const blob = await downscaleImage(avatarFile, 512);
        const uploaded = await saveMeal.uploadImage(blob, "AVATAR");
        avatarImageId = uploaded.id;
      } else if (removeAvatar) {
        avatarImageId = null;
      }

      const patch: UpdateProfilePatch = {
        displayName: trimmedName,
        ...(avatarImageId !== undefined ? { avatarImageId } : {}),
        seller: {
          name: trimmedSellerName || null,
          type: sellerType || null,
          defaultPickup,
        },
      };

      const updated = await updateProfile(patch);
      session.setMe(updated);
      setAvatarFile(null);
      setRemoveAvatar(false);
      setAvatarPreview(updated.avatar?.url ?? null);
      setSaveSuccess("Đã lưu thay đổi tài khoản.");
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : "Không lưu được thay đổi. Vui lòng thử lại.");
    } finally {
      setSaving(false);
    }
  }

  async function handleLogout() {
    setLoggingOut(true);
    try {
      if (allDevices) {
        await logoutAll(true);
      }
      await session.signOut();
    } finally {
      router.replace("/login");
    }
  }

  const initial = (displayName.trim() || me.displayName || "S").charAt(0).toUpperCase();

  return (
    <>
      <ScreenHeader title="Cài đặt & PWA" backHref="/account" />
      <div className={styles.body}>
        <form className={styles.card} onSubmit={saveProfile} noValidate>
          <div className={styles.cardHead}>
            <h2 className={styles.sectionTitle}>Hồ sơ cá nhân</h2>
            {me.seller.verified ? <span className={styles.badge}>Đã xác minh</span> : null}
          </div>
          <p className={styles.sectionDesc}>
            SaveMeal chỉ thu thập tên hiển thị và thông tin liên hệ đăng nhập tối thiểu để phục vụ việc nhận món.
          </p>

          <div className={styles.avatarRow}>
            <div className={styles.avatar} aria-hidden="true">
              {avatarPreview ? (
                // eslint-disable-next-line @next/next/no-img-element -- user avatar preview or uploaded URL
                <img src={avatarPreview} alt="Ảnh đại diện" />
              ) : (
                initial
              )}
            </div>
            <div className={styles.avatarActions}>
              <label className={styles.uploadLabel}>
                Đổi ảnh đại diện
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(e) => {
                    pickAvatar(e.target.files?.[0] ?? null);
                    e.target.value = "";
                  }}
                />
              </label>
              {avatarPreview ? (
                <button type="button" className={styles.textBtn} onClick={clearAvatar}>
                  Gỡ ảnh
                </button>
              ) : null}
            </div>
          </div>

          <TextField
            label="Tên hiển thị"
            placeholder="Tên người bán/mua thấy khi giao nhận"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            maxLength={40}
            hint="2–40 ký tự."
          />

          <div className={styles.readonlyRow}>
            <span className={styles.readonlyLabel}>{me.phone ? "Số điện thoại đăng nhập" : "Email đăng nhập"}</span>
            <span className={styles.readonlyValue}>{me.phone ?? me.email ?? "Chưa cập nhật"}</span>
            <span className={styles.readonlyHint}>Thông tin đăng nhập chỉ đọc và không thể thay đổi ở phiên bản này.</span>
          </div>

          <h3 className={styles.sectionTitle} style={{ marginTop: 6 }}>
            Thông tin khi đăng pass món (tùy chọn)
          </h3>
          <p className={styles.sectionDesc}>
            Không bắt buộc — điền sẵn để tự động gợi ý mỗi khi bạn đăng món chia sẻ.
          </p>

          <TextField
            label="Tên người bán / cửa hàng"
            placeholder="Ví dụ: Tiệm bánh Mây"
            value={sellerName}
            onChange={(e) => setSellerName(e.target.value)}
            maxLength={60}
          />

          <SelectField
            label="Loại hình"
            value={sellerType}
            onChange={(e) => setSellerType(e.target.value as SellerType | "")}
          >
            <option value="">Chưa chọn</option>
            {SELLER_TYPES.map((t) => (
              <option key={t} value={t}>
                {SELLER_TYPE_LABEL[t]}
              </option>
            ))}
          </SelectField>

          <TextField
            label="Địa điểm nhận món mặc định (tại quầy)"
            placeholder="Số nhà, đường, phường nơi khách đến lấy món"
            value={pickupAddress}
            onChange={(e) => setPickupAddress(e.target.value)}
            maxLength={200}
            hint="Chỉ dùng làm điểm nhận món khi bạn đăng tin; không cần nhập địa chỉ nhà riêng."
          />

          <div className={styles.two}>
            <TextField
              label="Vĩ độ (lat)"
              placeholder="16.0478"
              inputMode="decimal"
              value={pickupLat}
              onChange={(e) => setPickupLat(e.target.value)}
            />
            <TextField
              label="Kinh độ (lng)"
              placeholder="108.2431"
              inputMode="decimal"
              value={pickupLng}
              onChange={(e) => setPickupLng(e.target.value)}
            />
          </div>

          <div className={styles.rowActions}>
            <Button
              type="button"
              variant="secondary"
              block={false}
              disabled={locating}
              onClick={useCurrentPickupLocation}
            >
              {locating ? "Đang lấy vị trí…" : "Ghim vị trí hiện tại"}
            </Button>
            {pickupAddress || pickupLat || pickupLng ? (
              <button type="button" className={styles.textBtnDanger} onClick={clearPickup}>
                Xóa điểm nhận mặc định
              </button>
            ) : null}
          </div>

          {saveError ? <Notice tone="error">{saveError}</Notice> : null}
          {saveSuccess ? <Notice tone="success">{saveSuccess}</Notice> : null}

          <Button type="submit" disabled={saving}>
            {saving ? "Đang lưu…" : "Lưu thay đổi"}
          </Button>
        </form>

        <section className={styles.card} aria-label="Ảnh QR ngân hàng mặc định">
          <div className={styles.cardHead}>
            <h2 className={styles.sectionTitle}>Ảnh QR ngân hàng mặc định (người bán)</h2>
            <span className={styles.badge}>0đ phí sàn</span>
          </div>
          <p className={styles.sectionDesc}>
            Tự động điền sẵn mỗi khi bạn đăng món có thu phí. Người mua chuyển khoản trực tiếp vào tài khoản của bạn.
          </p>

          <input
            ref={qrInputRef}
            type="file"
            accept="image/*"
            className="visually-hidden"
            onChange={(e) => {
              void handleBankQrUpload(e.target.files?.[0] ?? null);
              e.target.value = "";
            }}
          />

          {bankQr ? (
            <div className={styles.qrPreviewBox}>
              {/* eslint-disable-next-line @next/next/no-img-element -- default seller bank QR */}
              <img src={bankQr.url} alt="Ảnh QR ngân hàng mặc định" className={styles.qrThumb} />
              <div className={styles.qrMeta}>
                <p className={styles.qrStatus}>{qrBusy ? "Đang cập nhật ảnh QR…" : "Đã lưu ảnh QR mặc định"}</p>
                <div className={styles.qrActions}>
                  <button
                    type="button"
                    className={styles.qrActionBtn}
                    disabled={qrBusy}
                    onClick={() => qrInputRef.current?.click()}
                  >
                    Đổi ảnh QR
                  </button>
                  <button
                    type="button"
                    className={styles.textBtnDanger}
                    disabled={qrBusy}
                    onClick={handleBankQrClear}
                  >
                    Xóa ảnh QR
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className={styles.qrEmptyBtn}
              disabled={qrBusy}
              onClick={() => qrInputRef.current?.click()}
            >
              <span className={styles.qrEmptyTitle}>
                {qrBusy ? "Đang tải ảnh QR…" : "Tải ảnh QR ngân hàng của bạn"}
              </span>
              <span className={styles.qrEmptySub}>Hỗ trợ JPG, PNG, WebP · dùng cho chuyển khoản P2P</span>
            </button>
          )}

          {qrError ? <Notice tone="error">{qrError}</Notice> : null}
          {qrSuccess ? <Notice tone="success">{qrSuccess}</Notice> : null}
        </section>

        <PwaInstallCard />

        <section className={styles.card}>
          <h2 className={styles.sectionTitle}>Phiên đăng nhập</h2>
          <label className={styles.checkboxRow}>
            <input
              type="checkbox"
              checked={allDevices}
              onChange={(e) => setAllDevices(e.target.checked)}
            />
            <span>Đăng xuất khỏi tất cả thiết bị đã đăng nhập</span>
          </label>
          <Button type="button" variant="secondary" disabled={loggingOut} onClick={handleLogout}>
            {loggingOut ? "Đang đăng xuất…" : allDevices ? "Đăng xuất tất cả thiết bị" : "Đăng xuất"}
          </Button>
        </section>

        <DeleteAccountSection />
      </div>
    </>
  );
}

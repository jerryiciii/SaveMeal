"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { Button, Notice, ScreenHeader, TextArea, TextField } from "@/components/ui";
import { getClientLocation } from "@/features/discover/clientLocation";
import { STORAGE_LABEL } from "@/features/orders/labels";
import { useSession } from "@/features/auth/SessionProvider";
import { saveMeal } from "@/lib/api";
import { ApiError } from "@/lib/contract/errors";
import type { Image, ListingOwnerView, PickupLocation, Storage } from "@/lib/contract/types";
import { downscaleImage } from "@/lib/image";
import { addMinutes, nextHalfHour, vnDate, vnDayOffset, vnIso, vnTime } from "@/lib/time";
import { useLoad } from "@/lib/useLoad";
import styles from "./post.module.css";

const LocationPickerMap = dynamic(() => import("./LocationPickerMap"), {
  ssr: false,
  loading: () => <div className={styles.mapSkeleton} aria-label="Đang tải bản đồ chọn điểm nhận…" />,
});

const STORAGES: Storage[] = ["ROOM_TEMP", "CHILLED", "FROZEN"];
const DEFAULT_PICKUP_COORDS = { lat: 16.0544, lng: 108.2022 };

type NominatimSearchHit = {
  lat?: string;
  lon?: string;
  display_name?: string;
};

type NominatimReverseHit = {
  display_name?: string;
  address?: {
    house_number?: string;
    road?: string;
    suburb?: string;
    quarter?: string;
    city_district?: string;
    city?: string;
    town?: string;
    state?: string;
  };
};

function formatReverseAddress(data: NominatimReverseHit): string {
  const a = data.address;
  if (a) {
    const street = [a.house_number, a.road].filter(Boolean).join(" ");
    const locality = a.suburb ?? a.quarter ?? a.city_district;
    const city = a.city ?? a.town ?? a.state;
    const compact = [street, locality, city].filter(Boolean).join(", ");
    if (compact) return compact;
  }
  return data.display_name?.trim() ?? "";
}

/** SaveMeal V2.1 · Step 2/3 — Pickup window, storage, map pin & optional seller bank QR (25b). */
export function PostDetails({ id }: { id: string }) {
  const { state } = useLoad(() => saveMeal.getListing(id) as Promise<ListingOwnerView>, [id]);
  if (state.kind === "loading") {
    return (
      <div className={styles.screen}>
        <ScreenHeader title="Đăng món · Bước 2/3" subtitle="Giờ nhận & điểm nhận" />
        <div className={styles.dashes} role="progressbar" aria-valuemin={1} aria-valuemax={3} aria-valuenow={2} aria-label="Tiến độ đăng món">
          <span className={`${styles.dash} ${styles.dashDone}`} />
          <span className={`${styles.dash} ${styles.dashActive}`} />
          <span className={styles.dash} />
        </div>
      </div>
    );
  }
  if (state.kind === "error") {
    return (
      <div className={styles.screen}>
        <ScreenHeader title="Đăng món · Bước 2/3" />
        <div className={styles.body}>
          <Notice tone="error">{state.error.message}</Notice>
        </div>
      </div>
    );
  }
  return <DetailsForm listing={state.data} />;
}

function DetailsForm({ listing }: { listing: ListingOwnerView }) {
  const router = useRouter();
  const session = useSession();
  const me = session.status === "authenticated" ? session.me : null;
  const start0 = listing.pickupStart ? vnTime(listing.pickupStart) : nextHalfHour();
  const [day, setDay] = useState<0 | 1>(listing.pickupStart ? (vnDayOffset(listing.pickupStart) ?? 0) : 0);
  const [start, setStart] = useState(start0);
  const [end, setEnd] = useState(listing.pickupEnd ? vnTime(listing.pickupEnd) : addMinutes(start0, 60));
  const [prepared, setPrepared] = useState(listing.preparedAt ? vnTime(listing.preparedAt) : addMinutes(nextHalfHour(), -240));
  const [storage, setStorage] = useState<Storage>(listing.storage ?? "ROOM_TEMP");
  const [storageNote, setStorageNote] = useState(listing.storageNote ?? "");
  const [ingredients, setIngredients] = useState(listing.ingredients ?? "");
  const initialPickup: PickupLocation | null =
    listing.pickup?.address ? listing.pickup : (me?.seller.defaultPickup ?? null);
  const [address, setAddress] = useState(initialPickup?.address ?? "");
  const [coords, setCoords] = useState<{ lat: number; lng: number }>(() => {
    if (listing.pickup) return { lat: listing.pickup.lat, lng: listing.pickup.lng };
    if (me?.seller.defaultPickup) return { lat: me.seller.defaultPickup.lat, lng: me.seller.defaultPickup.lng };
    return getClientLocation() ?? DEFAULT_PICKUP_COORDS;
  });
  const [pinned, setPinned] = useState<boolean>(() => Boolean(listing.pickup || me?.seller.defaultPickup || getClientLocation()));
  const [sellerName, setSellerName] = useState(me?.seller.name ?? me?.displayName ?? "");
  const [bankQr, setBankQr] = useState<Image | null>(listing.bankQrImage ?? me?.seller.bankQrImage ?? null);
  const [qrUploading, setQrUploading] = useState(false);
  const [qrError, setQrError] = useState<string | null>(null);
  const qrInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [geoMessage, setGeoMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(false);
  const [searchingAddress, setSearchingAddress] = useState(false);

  async function handleQrFile(file: File | null) {
    if (!file) return;
    setQrError(null);
    setQrUploading(true);
    try {
      const blob = await downscaleImage(file);
      const uploaded = await saveMeal.uploadImage(blob, "PAYMENT_QR");
      setBankQr(uploaded);
    } catch (err) {
      setQrError(err instanceof ApiError ? err.message : "Không tải được ảnh QR. Vui lòng thử lại.");
    } finally {
      setQrUploading(false);
    }
  }

  async function findOnMap() {
    const q = address.trim();
    if (!q) {
      setGeoMessage("Nhập địa chỉ nhận trước khi tìm trên bản đồ.");
      return;
    }
    setSearchingAddress(true);
    setGeoMessage(null);
    setError(null);
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=vn&q=${encodeURIComponent(q)}`,
        { headers: { "Accept-Language": "vi,en" } },
      );
      if (!res.ok) throw new Error("Nominatim search failed");
      const results = (await res.json()) as NominatimSearchHit[];
      const hit = results[0];
      const lat = hit?.lat ? Number(hit.lat) : Number.NaN;
      const lng = hit?.lon ? Number(hit.lon) : Number.NaN;
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        setCoords({ lat, lng });
        setPinned(true);
      } else {
        setGeoMessage("Không tìm thấy địa chỉ này. Bạn có thể chạm trực tiếp vào bản đồ hoặc kéo ghim để chọn điểm nhận.");
      }
    } catch {
      setGeoMessage("Chưa tìm được địa chỉ lúc này. Bạn có thể chạm trực tiếp vào bản đồ hoặc kéo ghim để chọn điểm nhận.");
    } finally {
      setSearchingAddress(false);
    }
  }

  function useMyLocation() {
    if (!("geolocation" in navigator)) {
      setGeoMessage("Thiết bị không hỗ trợ định vị. Bạn có thể chạm trực tiếp vào bản đồ để ghim điểm nhận.");
      return;
    }
    setLocating(true);
    setGeoMessage(null);
    setError(null);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        const point = { lat: p.coords.latitude, lng: p.coords.longitude };
        setCoords(point);
        setPinned(true);
        setLocating(false);
        if (!address.trim()) {
          void fetch(
            `https://nominatim.openstreetmap.org/reverse?format=json&lat=${encodeURIComponent(String(point.lat))}&lon=${encodeURIComponent(String(point.lng))}`,
            { headers: { "Accept-Language": "vi,en" } },
          )
            .then((res) => (res.ok ? (res.json() as Promise<NominatimReverseHit>) : null))
            .then((data) => {
              if (!data) return;
              const formatted = formatReverseAddress(data);
              if (formatted) {
                setAddress((prev) => (prev.trim() ? prev : formatted));
              }
            })
            .catch(() => {
              // Reverse geocoding is optional; ignore network errors.
            });
        }
      },
      () => {
        setGeoMessage("Chưa lấy được vị trí. Bạn có thể cấp quyền vị trí hoặc chạm/kéo ghim trực tiếp trên bản đồ.");
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }

  async function next(e: FormEvent) {
    e.preventDefault();
    const d = vnDate(day);
    const startIso = vnIso(d, start);
    const endIso = vnIso(d, end);
    const preparedIso = vnIso(vnDate(0), prepared);
    if (Date.parse(endIso) <= Date.parse(startIso)) return setError("Giờ kết thúc phải sau giờ bắt đầu.");
    if (Date.parse(endIso) - Date.parse(startIso) > 4 * 3_600_000) return setError("Khung giờ nhận tối đa 4 giờ.");
    if (Date.parse(endIso) <= Date.now()) return setError("Giờ kết thúc nhận đã qua.");
    if (Date.parse(preparedIso) > Date.now()) return setError("Thời điểm chế biến phải ở trong quá khứ.");
    if (!address.trim()) return setError("Nhập địa chỉ điểm nhận.");
    setBusy(true);
    setError(null);
    try {
      const pickup = { address: address.trim(), lat: coords.lat, lng: coords.lng };
      const isPaid = listing.price > 0;
      const needsProfilePatch = Boolean(
        me && (!me.seller.defaultPickup || (sellerName.trim() && sellerName.trim() !== me.seller.name)),
      );
      const bankQrChanged = Boolean(me && isPaid && bankQr?.id && bankQr.id !== me.seller.bankQrImage?.id);
      const updateListingPromise = saveMeal.updateListing(listing.id, {
        pickupStart: startIso,
        pickupEnd: endIso,
        preparedAt: preparedIso,
        storage,
        storageNote: storageNote.trim() || null,
        ingredients: ingredients.trim() || null,
        pickup,
        ...(isPaid ? { bankQrImageId: bankQr?.id ?? null } : {}),
      });
      const updateMePromise =
        me && (needsProfilePatch || bankQrChanged)
          ? saveMeal.updateMe({
              seller: {
                ...(needsProfilePatch ? { name: sellerName.trim() || null, defaultPickup: pickup } : {}),
                ...(bankQrChanged && bankQr ? { bankQrImageId: bankQr.id } : {}),
              },
            })
          : null;
      const [, updatedMe] = await Promise.all([updateListingPromise, updateMePromise]);
      if (updatedMe) {
        session.setMe(updatedMe);
      }
      router.push(`/post/${listing.id}/checklist`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Không lưu được. Vui lòng thử lại.");
      setBusy(false);
    }
  }

  return (
    <div className={styles.screen}>
      <ScreenHeader title="Đăng món · Bước 2/3" subtitle="Giờ nhận & điểm nhận" />
      <div
        className={styles.dashes}
        role="progressbar"
        aria-valuemin={1}
        aria-valuemax={3}
        aria-valuenow={2}
        aria-label="Tiến độ đăng món"
      >
        <span className={`${styles.dash} ${styles.dashDone}`} />
        <span className={`${styles.dash} ${styles.dashActive}`} />
        <span className={styles.dash} />
      </div>

      <form className={styles.formShell} onSubmit={next} noValidate>
        <div className={styles.body}>
          {/* Card 1 · Khung giờ nhận & chế biến */}
          <section className={styles.card} aria-labelledby="card-pickup-time">
            <h2 id="card-pickup-time" className={styles.cardTitle}>
              Khung giờ nhận &amp; chế biến
            </h2>
            <p className={styles.cardSub}>Khách đến nhận trực tiếp trong khung giờ bạn mở.</p>
            <div className={styles.track} role="group" aria-label="Ngày nhận">
              <button
                type="button"
                className={`${styles.trackBtn} ${day === 0 ? styles.trackBtnActive : ""}`}
                aria-pressed={day === 0}
                onClick={() => setDay(0)}
              >
                Hôm nay
              </button>
              <button
                type="button"
                className={`${styles.trackBtn} ${day === 1 ? styles.trackBtnActive : ""}`}
                aria-pressed={day === 1}
                onClick={() => setDay(1)}
              >
                Ngày mai
              </button>
            </div>
            <div className={styles.two}>
              <TextField
                label="Bắt đầu nhận"
                type="time"
                className={styles.tabular}
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
              <TextField
                label="Kết thúc nhận"
                type="time"
                className={styles.tabular}
                value={end}
                onChange={(e) => setEnd(e.target.value)}
              />
            </div>
            <TextField
              label="Chế biến / đóng gói lúc"
              type="time"
              className={styles.tabular}
              value={prepared}
              onChange={(e) => setPrepared(e.target.value)}
              hint="Tính trong hôm nay · tối đa 4 giờ cho khung giờ nhận"
            />
          </section>

          {/* Card 2 · Bảo quản & thành phần */}
          <section className={styles.card} aria-labelledby="card-storage">
            <h2 id="card-storage" className={styles.cardTitle}>
              Bảo quản &amp; thành phần
            </h2>
            <div className={styles.segRow} role="group" aria-label="Điều kiện bảo quản">
              {STORAGES.map((s) => (
                <button
                  key={s}
                  type="button"
                  className={`${styles.seg} ${storage === s ? styles.segActive : ""}`}
                  aria-pressed={storage === s}
                  onClick={() => setStorage(s)}
                >
                  {STORAGE_LABEL[s]}
                </button>
              ))}
            </div>
            <TextField
              label="Ghi chú bảo quản (nếu có)"
              placeholder="Ví dụ: ăn ngon nhất trong 2 giờ, hâm nóng trước khi dùng"
              value={storageNote}
              onChange={(e) => setStorageNote(e.target.value)}
            />
            <TextArea
              label="Thành phần và dị ứng (nếu có)"
              placeholder="Bột mì · sữa · bơ · gluten"
              value={ingredients}
              onChange={(e) => setIngredients(e.target.value)}
              hint="Không tự khai báo thông tin chưa xác minh."
            />
          </section>

          {/* Card 3 · Ghim điểm nhận trên bản đồ */}
          <section className={styles.card} aria-labelledby="card-pickup-map">
            <h2 id="card-pickup-map" className={styles.cardTitle}>
              Ghim điểm nhận trên bản đồ
            </h2>
            <TextField
              label="Địa điểm nhận"
              placeholder="Số nhà, đường, phường"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
            />
            <div className={styles.locationActions}>
              <button
                type="button"
                className={styles.locationBtn}
                onClick={findOnMap}
                disabled={searchingAddress || locating}
              >
                {searchingAddress ? "Đang tìm…" : "Tìm trên bản đồ"}
              </button>
              <button
                type="button"
                className={styles.locationBtn}
                onClick={useMyLocation}
                disabled={locating || searchingAddress}
              >
                {locating ? "Đang lấy vị trí…" : "Dùng vị trí hiện tại"}
              </button>
            </div>
            {geoMessage ? <p className={styles.geoHint}>{geoMessage}</p> : null}
            <div className={styles.mapFrame}>
              <LocationPickerMap
                coords={coords}
                pinned={pinned}
                onChange={(nextCoords) => {
                  setCoords(nextCoords);
                  setPinned(true);
                  setGeoMessage(null);
                }}
              />
            </div>
            <TextField
              label="Tên người đăng / cửa hàng"
              placeholder="Ví dụ: Tiệm bánh Bơ Sáng"
              value={sellerName}
              onChange={(e) => setSellerName(e.target.value)}
              maxLength={60}
            />
          </section>

          {/* Card 4 · Ảnh QR ngân hàng nhận tiền (25b) */}
          {listing.price > 0 ? (
            <section className={styles.card} aria-labelledby="card-bank-qr">
              <div className={styles.cardHead}>
                <h2 id="card-bank-qr" className={styles.cardTitle}>
                  Ảnh QR ngân hàng nhận tiền
                </h2>
                <span className={styles.qrPill}>0đ phí sàn</span>
              </div>
              <input
                ref={qrInputRef}
                type="file"
                accept="image/*"
                className="visually-hidden"
                onChange={(e) => {
                  void handleQrFile(e.target.files?.[0] ?? null);
                  e.target.value = "";
                }}
              />
              {bankQr ? (
                <div className={styles.upl}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- uploaded payment QR preview */}
                  <img src={bankQr.url} alt="Ảnh QR ngân hàng nhận tiền" className={styles.qrThumb} />
                  <div className={styles.qrMeta}>
                    <p className={styles.qrStatus}>
                      {qrUploading ? (
                        <span className={styles.qrSpinRow}>
                          <span className={styles.qrSpinner} aria-hidden="true" />
                          Đang tải ảnh QR mới…
                        </span>
                      ) : (
                        "Đã có ảnh QR nhận tiền"
                      )}
                    </p>
                    <p className={styles.qrSub}>Tự động lưu làm QR mặc định cho các lần đăng sau.</p>
                    <div className={styles.qrActions}>
                      <button
                        type="button"
                        className={styles.qrActionBtn}
                        disabled={qrUploading}
                        onClick={() => qrInputRef.current?.click()}
                      >
                        Đổi ảnh QR
                      </button>
                      <button
                        type="button"
                        className={styles.qrRemoveBtn}
                        disabled={qrUploading}
                        onClick={() => {
                          setBankQr(null);
                          setQrError(null);
                        }}
                      >
                        Xóa
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  className={`${styles.upl} ${styles.empty}`}
                  disabled={qrUploading}
                  onClick={() => qrInputRef.current?.click()}
                >
                  {qrUploading ? (
                    <span className={styles.qrSpinRow}>
                      <span className={styles.qrSpinner} aria-hidden="true" />
                      Đang tải ảnh QR…
                    </span>
                  ) : (
                    <>
                      <span className={styles.limeSoftTile} aria-hidden="true">
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="3" y="3" width="7" height="7" rx="1.5" />
                          <rect x="14" y="3" width="7" height="7" rx="1.5" />
                          <rect x="3" y="14" width="7" height="7" rx="1.5" />
                          <path d="M14 14h3v3h-3z" />
                          <path d="M20 14v3h-1" />
                          <path d="M14 20h3" />
                          <path d="M20 20h.01" />
                        </svg>
                      </span>
                      <span className={styles.qrUploadTitle}>Tải ảnh QR ngân hàng của bạn</span>
                      <span className={styles.qrUploadSub}>
                        Người mua chuyển khoản trực tiếp · 0đ phí sàn · tự lưu cho lần đăng sau
                      </span>
                    </>
                  )}
                </button>
              )}
              {qrError ? <Notice tone="error">{qrError}</Notice> : null}
            </section>
          ) : (
            <p className={styles.freeQrNote}>Món miễn phí (0đ) không cần ảnh QR ngân hàng.</p>
          )}

          {error ? <Notice tone="error">{error}</Notice> : null}
        </div>

        <div className={styles.footer}>
          <Button type="submit" className={styles.cta} disabled={busy || qrUploading}>
            {busy ? "Đang lưu…" : "Tiếp tục · 6 cam kết"}
          </Button>
        </div>
      </form>
    </div>
  );
}

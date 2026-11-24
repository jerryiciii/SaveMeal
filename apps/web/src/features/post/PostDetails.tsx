"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { Button, Chip, Notice, ScreenHeader, TextArea, TextField } from "@/components/ui";
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

/** Figma V1 25 · Đăng món · giờ nhận & bảo quản (9:181) → LIST-4 (+ ME-2 to remember the pickup point). */
export function PostDetails({ id }: { id: string }) {
  const { state } = useLoad(() => saveMeal.getListing(id) as Promise<ListingOwnerView>, [id]);
  if (state.kind === "loading") return <ScreenHeader title="Đăng món · Bước 2/3" />;
  if (state.kind === "error") {
    return (
      <>
        <ScreenHeader title="Đăng món · Bước 2/3" />
        <div className={styles.body}>
          <Notice tone="error">{state.error.message}</Notice>
        </div>
      </>
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
    <>
      <ScreenHeader title="Đăng món · Bước 2/3" subtitle="Thông tin nhận hàng" />
      <form className={styles.body} onSubmit={next} noValidate>
        <div className={styles.stepper} aria-label="Tiến độ đăng món">
          <span className={`${styles.stepPill} ${styles.stepDone}`}>✓ Ảnh &amp; giá</span>
          <span className={`${styles.stepPill} ${styles.stepActive}`}>2 · Giờ &amp; điểm</span>
          <span className={styles.stepPill}>3 · 6 cam kết</span>
        </div>
        <p className={styles.lead}>Món sẽ được khách đến nhận trực tiếp.</p>
        <p className={styles.sectionLabel}>Ngày nhận</p>
        <div className={styles.chips}>
          <Chip selected={day === 0} onClick={() => setDay(0)}>
            Hôm nay
          </Chip>
          <Chip selected={day === 1} onClick={() => setDay(1)}>
            Ngày mai
          </Chip>
        </div>
        <div className={styles.two}>
          <TextField label="Bắt đầu nhận" type="time" value={start} onChange={(e) => setStart(e.target.value)} />
          <TextField label="Kết thúc nhận" type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
        </div>
        <TextField label="Chế biến / đóng gói lúc (hôm nay)" type="time" value={prepared} onChange={(e) => setPrepared(e.target.value)} />
        <p className={styles.sectionLabel}>Điều kiện bảo quản</p>
        <div className={styles.chips}>
          {STORAGES.map((s) => (
            <Chip key={s} selected={storage === s} onClick={() => setStorage(s)}>
              {STORAGE_LABEL[s]}
            </Chip>
          ))}
        </div>
        <TextField label="Ghi chú bảo quản (nếu có)" value={storageNote} onChange={(e) => setStorageNote(e.target.value)} />
        <TextArea
          label="Thành phần và dị ứng (nếu có)"
          placeholder="Bột mì · sữa · bơ · gluten"
          value={ingredients}
          onChange={(e) => setIngredients(e.target.value)}
          hint="Không tự khai báo thông tin chưa xác minh."
        />
        <TextField label="Tên người bán / cửa hàng" value={sellerName} onChange={(e) => setSellerName(e.target.value)} maxLength={60} />
        <TextField label="Địa điểm nhận" placeholder="Số nhà, đường, phường" value={address} onChange={(e) => setAddress(e.target.value)} />
        <div className={styles.locationActions}>
          <Button
            type="button"
            variant="secondary"
            className={styles.locationBtn}
            onClick={findOnMap}
            disabled={searchingAddress || locating}
          >
            {searchingAddress ? "Đang tìm…" : "Tìm trên bản đồ"}
          </Button>
          <Button
            type="button"
            variant="secondary"
            className={styles.locationBtn}
            onClick={useMyLocation}
            disabled={locating || searchingAddress}
          >
            {locating ? "Đang lấy vị trí…" : "Dùng vị trí hiện tại"}
          </Button>
        </div>
        {geoMessage ? <p className={styles.geoHint}>{geoMessage}</p> : null}
        <LocationPickerMap
          coords={coords}
          pinned={pinned}
          onChange={(nextCoords) => {
            setCoords(nextCoords);
            setPinned(true);
            setGeoMessage(null);
          }}
        />
        {listing.price > 0 ? (
          <section className={styles.qrCard} aria-label="Ảnh QR ngân hàng nhận tiền">
            <div className={styles.qrHead}>
              <h2 className={styles.qrTitle}>Ảnh QR ngân hàng nhận tiền (chuyển khoản P2P)</h2>
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
        <Button type="submit" disabled={busy || qrUploading}>
          {busy ? "Đang lưu…" : "Tiếp tục · Kiểm tra an toàn"}
        </Button>
      </form>
    </>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button, Chip, Notice, ScreenHeader, TextArea, TextField } from "@/components/ui";
import { STORAGE_LABEL } from "@/features/orders/labels";
import { useSession } from "@/features/auth/SessionProvider";
import { saveMeal } from "@/lib/api";
import { ApiError } from "@/lib/contract/errors";
import type { ListingOwnerView, PickupLocation, Storage } from "@/lib/contract/types";
import { addMinutes, nextHalfHour, vnDate, vnDayOffset, vnIso, vnTime } from "@/lib/time";
import { useLoad } from "@/lib/useLoad";
import styles from "./post.module.css";

const STORAGES: Storage[] = ["ROOM_TEMP", "CHILLED", "FROZEN"];

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
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(
    initialPickup ? { lat: initialPickup.lat, lng: initialPickup.lng } : null,
  );
  const [sellerName, setSellerName] = useState(me?.seller.name ?? me?.displayName ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(false);

  function useMyLocation() {
    if (!("geolocation" in navigator)) return setError("Thiết bị không hỗ trợ định vị.");
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setCoords({ lat: p.coords.latitude, lng: p.coords.longitude });
        setLocating(false);
      },
      () => {
        setError("Chưa lấy được vị trí. Cho phép quyền vị trí để ghim điểm nhận.");
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
    if (!address.trim() || !coords) return setError("Nhập địa chỉ và ghim vị trí điểm nhận.");
    setBusy(true);
    setError(null);
    try {
      const pickup = { address: address.trim(), lat: coords.lat, lng: coords.lng };
      await saveMeal.updateListing(listing.id, {
        pickupStart: startIso,
        pickupEnd: endIso,
        preparedAt: preparedIso,
        storage,
        storageNote: storageNote.trim() || null,
        ingredients: ingredients.trim() || null,
        pickup,
      });
      if (me && (!me.seller.defaultPickup || (sellerName.trim() && sellerName.trim() !== me.seller.name))) {
        session.setMe(await saveMeal.updateMe({ seller: { name: sellerName.trim() || null, defaultPickup: pickup } }));
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
        <Button type="button" variant="secondary" onClick={useMyLocation} disabled={locating}>
          {coords ? "Đã ghim vị trí · Ghim lại theo vị trí hiện tại" : locating ? "Đang lấy vị trí…" : "Ghim vị trí điểm nhận"}
        </Button>
        {error ? <Notice tone="error">{error}</Notice> : null}
        <Button type="submit" disabled={busy}>
          {busy ? "Đang lưu…" : "Tiếp tục · Kiểm tra an toàn"}
        </Button>
      </form>
    </>
  );
}

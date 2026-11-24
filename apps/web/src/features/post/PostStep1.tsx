"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button, Notice, SelectField, TextField } from "@/components/ui";
import { saveMeal } from "@/lib/api";
import { ApiError } from "@/lib/contract/errors";
import { CATEGORIES, type Category } from "@/lib/contract/types";
import { downscaleImage } from "@/lib/image";
import { CATEGORY_LABEL } from "./labels";
import styles from "./post.module.css";

/** Parses "15.000", "15000", "15k" → 15000; empty → null. */
export function parseVnd(input: string): number | null {
  const s = input.trim().toLowerCase().replace(/đ|\s/g, "");
  if (!s) return null;
  const k = s.endsWith("k");
  const n = Number(s.replace(/k$/, "").replace(/[.,]/g, ""));
  if (!Number.isFinite(n)) return NaN;
  return k ? n * 1000 : n;
}

/** Figma V1 07 · Đăng pass món (2:324): photo, name, price, portions, origin → LIST-3 draft. */
export function PostStep1() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<Category>("BAKERY");
  const [price, setPrice] = useState("");
  const [original, setOriginal] = useState("");
  const [qty, setQty] = useState("1");
  const [origin, setOrigin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function pick(f: File | null) {
    setFile(f);
    setPreview((old) => {
      if (old) URL.revokeObjectURL(old);
      return f ? URL.createObjectURL(f) : null;
    });
  }

  async function next(e: FormEvent) {
    e.preventDefault();
    const p = parseVnd(price);
    const o = parseVnd(original);
    const q = Number(qty);
    if (!file) return setError("Thêm ảnh thật của món.");
    if (title.trim().length < 3) return setError("Tên món cần ít nhất 3 ký tự.");
    if (p === null || Number.isNaN(p) || p < 0) return setError("Nhập giá bán (0 nếu tặng miễn phí).");
    if (o !== null && (Number.isNaN(o) || o < p)) return setError("Giá gốc phải lớn hơn hoặc bằng giá bán.");
    if (!Number.isInteger(q) || q < 1 || q > 50) return setError("Số suất từ 1 đến 50.");
    if (!origin.trim()) return setError("Ghi rõ nguồn gốc món (ví dụ: làm tại tiệm sáng nay).");
    setBusy(true);
    setError(null);
    try {
      const img = await saveMeal.uploadImage(await downscaleImage(file), "LISTING");
      const draft = await saveMeal.createListing({
        title: title.trim(),
        category,
        imageIds: [img.id],
        price: p,
        originalPrice: o,
        quantityTotal: q,
        origin: origin.trim(),
      });
      router.push(`/post/${draft.id}/details`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Không lưu được tin. Vui lòng thử lại.");
      setBusy(false);
    }
  }

  return (
    <form className={styles.body} onSubmit={next} noValidate>
      <h1 className={styles.h1}>Đăng pass đồ ăn</h1>
      <p className={styles.lead}>Cứu món ngon, giảm lãng phí.</p>
      <div className={styles.stepper} aria-label="Tiến độ đăng món">
        <span className={`${styles.stepPill} ${styles.stepActive}`}>1 · Ảnh &amp; giá</span>
        <span className={styles.stepPill}>2 · Giờ &amp; điểm</span>
        <span className={styles.stepPill}>3 · 6 cam kết</span>
      </div>
      <label className={styles.photo}>
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element -- local object URL preview
          <img src={preview} alt="Ảnh món đã chọn" />
        ) : (
          <span>＋ Thêm ảnh món ăn</span>
        )}
        <input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={(e) => pick(e.target.files?.[0] ?? null)} />
      </label>
      <TextField label="Tên món" placeholder="Ví dụ: bánh croissant bơ" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} />
      <SelectField label="Loại món" value={category} onChange={(e) => setCategory(e.target.value as Category)}>
        {CATEGORIES.map((c) => (
          <option key={c} value={c}>
            {CATEGORY_LABEL[c]}
          </option>
        ))}
      </SelectField>
      <div className={styles.two}>
        <TextField label="Giá pass" placeholder="15.000" inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value)} hint="0 = miễn phí" />
        <TextField label="Giá gốc (nếu có)" placeholder="25.000" inputMode="numeric" value={original} onChange={(e) => setOriginal(e.target.value)} />
      </div>
      <TextField label="Số suất" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value.replace(/\D/g, ""))} />
      <TextField label="Nguồn gốc" placeholder="Làm tại tiệm sáng nay" value={origin} onChange={(e) => setOrigin(e.target.value)} maxLength={200} />
      {error ? <Notice tone="error">{error}</Notice> : null}
      <Button type="submit" disabled={busy}>
        {busy ? "Đang lưu…" : "Tiếp tục · Thời gian & an toàn"}
      </Button>
    </form>
  );
}

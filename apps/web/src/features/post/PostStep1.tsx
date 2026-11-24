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

/** SaveMeal V2.1 · Step 1/3 — Photo, name, category, price, portions, origin → LIST-3 draft. */
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
    <div className={styles.screen}>
      <header className={styles.topHeader}>
        <h1 className={styles.h1}>Đăng pass đồ ăn</h1>
        <p className={styles.lead}>Cứu món ngon, giảm lãng phí.</p>
      </header>
      <div
        className={styles.dashes}
        role="progressbar"
        aria-valuemin={1}
        aria-valuemax={3}
        aria-valuenow={1}
        aria-label="Tiến độ đăng món"
      >
        <span className={`${styles.dash} ${styles.dashActive}`} />
        <span className={styles.dash} />
        <span className={styles.dash} />
      </div>

      <form className={styles.body} onSubmit={next} noValidate>
        <section className={styles.card} aria-labelledby="card-photo">
          <h2 id="card-photo" className={styles.cardTitle}>
            Ảnh thật của món
          </h2>
          <label className={styles.photo}>
            {preview ? (
              // eslint-disable-next-line @next/next/no-img-element -- local object URL preview
              <img src={preview} alt="Ảnh món đã chọn" />
            ) : (
              <>
                <span className={styles.limeSoftTile} aria-hidden="true">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                    <circle cx="12" cy="13" r="4" />
                  </svg>
                </span>
                <span className={styles.photoTitle}>Thêm ảnh món ăn</span>
                <span className={styles.photoSub}>Chụp trực tiếp hoặc chọn từ thư viện</span>
              </>
            )}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              capture="environment"
              onChange={(e) => pick(e.target.files?.[0] ?? null)}
            />
          </label>
        </section>

        <section className={styles.card} aria-labelledby="card-info">
          <h2 id="card-info" className={styles.cardTitle}>
            Thông tin món &amp; giá pass
          </h2>
          <TextField
            label="Tên món"
            placeholder="Ví dụ: bánh croissant bơ"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={80}
          />
          <SelectField label="Loại món" value={category} onChange={(e) => setCategory(e.target.value as Category)}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABEL[c]}
              </option>
            ))}
          </SelectField>
          <div className={styles.two}>
            <TextField
              label="Giá pass"
              placeholder="15.000"
              inputMode="numeric"
              className={styles.tabular}
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              hint="0 = miễn phí"
            />
            <TextField
              label="Giá gốc (nếu có)"
              placeholder="25.000"
              inputMode="numeric"
              className={styles.tabular}
              value={original}
              onChange={(e) => setOriginal(e.target.value)}
            />
          </div>
          <TextField
            label="Số suất"
            inputMode="numeric"
            className={styles.tabular}
            value={qty}
            onChange={(e) => setQty(e.target.value.replace(/\D/g, ""))}
          />
          <TextField
            label="Nguồn gốc"
            placeholder="Làm tại tiệm sáng nay"
            value={origin}
            onChange={(e) => setOrigin(e.target.value)}
            maxLength={200}
          />
        </section>

        {error ? <Notice tone="error">{error}</Notice> : null}

        <Button type="submit" className={styles.cta} disabled={busy}>
          {busy ? "Đang lưu…" : "Tiếp tục · Giờ & điểm nhận"}
        </Button>
      </form>
    </div>
  );
}

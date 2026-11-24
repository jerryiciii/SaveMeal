"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Notice, ScreenHeader } from "@/components/ui";
import { saveMeal } from "@/lib/api";
import { DECLARATION_KEYS, type DeclarationKey, type ListingOwnerView } from "@/lib/contract/types";
import { useLoad } from "@/lib/useLoad";
import { CHECKLIST_LABEL, DECLARATION_LABEL } from "./labels";
import styles from "./post.module.css";

export const declarationStorageKey = (id: string) => `sm-decl-${id}`;

/**
 * Figma V1 26 · Checklist an toàn thực phẩm (9:210). All 6 declarations are required;
 * they are sent with publish (LIST-6). There is no skip and no partial publish.
 */
export function PostChecklist({ id }: { id: string }) {
  const router = useRouter();
  const { state } = useLoad(() => saveMeal.getListing(id) as Promise<ListingOwnerView>, [id]);
  const [checked, setChecked] = useState<Record<DeclarationKey, boolean>>(
    () => Object.fromEntries(DECLARATION_KEYS.map((k) => [k, false])) as Record<DeclarationKey, boolean>,
  );
  const all = DECLARATION_KEYS.every((k) => checked[k]);
  const missing = state.kind === "ready" ? state.data.missing : [];

  function next() {
    try {
      sessionStorage.setItem(declarationStorageKey(id), JSON.stringify(checked));
    } catch {
      // the preview screen asks again if storage is unavailable
    }
    router.push(`/post/${id}/preview`);
  }

  return (
    <>
      <ScreenHeader title="Kiểm tra an toàn" subtitle="Bắt buộc trước khi đăng" />
      <div className={styles.body}>
        <div className={styles.stepper} aria-label="Tiến độ đăng món">
          <span className={`${styles.stepPill} ${styles.stepDone}`}>✓ Ảnh &amp; giá</span>
          <span className={`${styles.stepPill} ${styles.stepDone}`}>✓ Giờ &amp; điểm</span>
          <span className={`${styles.stepPill} ${styles.stepActive}`}>3 · 6 cam kết</span>
        </div>
        {missing.length > 0 ? (
          <section className={styles.missingCard} aria-label="Thông tin còn thiếu">
            <p className={styles.missingTitle}>Tin còn thiếu thông tin bắt buộc</p>
            <ul className={styles.missingList}>
              {missing.map((k) => (
                <li key={k}>{CHECKLIST_LABEL[k]}</li>
              ))}
            </ul>
            <Link className={styles.missingLink} href={`/post/${id}/details`}>
              Quay lại Bước 2 để bổ sung
            </Link>
          </section>
        ) : null}
        {DECLARATION_KEYS.map((k) => {
          const isChecked = checked[k];
          return (
            <label key={k} className={`${styles.check} ${isChecked ? styles.checkChecked : ""}`}>
              <input
                type="checkbox"
                checked={isChecked}
                onChange={(e) => setChecked((c) => ({ ...c, [k]: e.target.checked }))}
              />
              <span className={styles.checkBox} aria-hidden="true">
                {isChecked ? "✓" : ""}
              </span>
              <span>{DECLARATION_LABEL[k]}</span>
            </label>
          );
        })}
        <Notice>
          <p>Nếu không chắc chắn về an toàn, không đăng. Bạn chịu trách nhiệm về món ăn và thông tin đã khai báo.</p>
        </Notice>
        <Button onClick={next} disabled={!all}>
          Tôi xác nhận · Xem trước
        </Button>
      </div>
    </>
  );
}

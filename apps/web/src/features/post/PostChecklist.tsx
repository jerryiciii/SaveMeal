"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Notice, ScreenHeader } from "@/components/ui";
import { DECLARATION_KEYS, type DeclarationKey } from "@/lib/contract/types";
import { DECLARATION_LABEL } from "./labels";
import styles from "./post.module.css";

export const declarationStorageKey = (id: string) => `sm-decl-${id}`;

/**
 * Figma V1 26 · Checklist an toàn thực phẩm (9:210). All 6 declarations are required;
 * they are sent with publish (LIST-6). There is no skip and no partial publish.
 */
export function PostChecklist({ id }: { id: string }) {
  const router = useRouter();
  const [checked, setChecked] = useState<Record<DeclarationKey, boolean>>(
    () => Object.fromEntries(DECLARATION_KEYS.map((k) => [k, false])) as Record<DeclarationKey, boolean>,
  );
  const all = DECLARATION_KEYS.every((k) => checked[k]);

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
        {DECLARATION_KEYS.map((k) => (
          <label key={k} className={styles.check}>
            <input type="checkbox" checked={checked[k]} onChange={(e) => setChecked((c) => ({ ...c, [k]: e.target.checked }))} />
            {DECLARATION_LABEL[k]}
          </label>
        ))}
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

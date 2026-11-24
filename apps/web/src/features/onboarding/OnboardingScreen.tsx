import Link from "next/link";
import styles from "./onboarding.module.css";

const STEPS = [
  {
    num: "01",
    title: "Tìm món quanh bạn trên bản đồ",
    desc: "Xem món ăn dư trong ngày từ tiệm bánh, quán ăn và người bán gần bạn với giá ưu đãi hoặc miễn phí.",
  },
  {
    num: "02",
    title: "Xem rõ thông tin trước khi giữ",
    desc: "Nguồn gốc, giờ chế biến, cách bảo quản và khung giờ nhận được người bán khai báo rõ ràng trên từng tin.",
  },
  {
    num: "03",
    title: "Đặt giữ & nhận trực tiếp tại quầy",
    desc: "Nhận mã QR cho từng suất, thanh toán trực tiếp cho người bán khi đến lấy. Không giao hàng, không phí ẩn.",
  },
] as const;

/** Figma V1 09 · Onboarding (7:2). Welcome screen linking to /onboarding/location and /. */
export function OnboardingScreen() {
  return (
    <div className={styles.screen}>
      <div className={styles.top}>
        <p className={styles.brand}>SaveMeal</p>
        <div className={styles.heroCard} aria-hidden="true">
          <div className={styles.heroMapGrid}>
            <span className={`${styles.pinBadge} ${styles.pinFree}`} style={{ top: "24%", left: "16%" }}>
              FREE
            </span>
            <span className={`${styles.pinBadge} ${styles.pinPriced}`} style={{ top: "18%", right: "18%" }}>
              15k
            </span>
            <span className={`${styles.pinBadge} ${styles.pinPriced}`} style={{ bottom: "32%", left: "46%" }}>
              18k
            </span>
          </div>
          <div className={styles.heroPreview}>
            <div>
              <p className={styles.previewTitle}>5 phần bánh còn nguyên</p>
              <p className={styles.previewMeta}>Tiệm bánh Mây · Nhận 17:30–18:30</p>
            </div>
            <span className={styles.previewPrice}>15.000đ</span>
          </div>
        </div>

        <h1 className={styles.title}>Cứu món ngon cuối ngày quanh bạn</h1>
        <p className={styles.lead}>
          Đặt giữ thực phẩm dư trong ngày với giá hợp lý, nhận trực tiếp tại quầy bằng mã QR.
        </p>

        <ol className={styles.steps}>
          {STEPS.map((item) => (
            <li key={item.num} className={styles.step}>
              <span className={styles.stepNum} aria-hidden="true">
                {item.num}
              </span>
              <div className={styles.stepText}>
                <h2 className={styles.stepTitle}>{item.title}</h2>
                <p className={styles.stepDesc}>{item.desc}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>

      <div className={styles.footer}>
        <Link href="/onboarding/location" className={styles.primaryLink}>
          Bắt đầu khám phá
        </Link>
        <Link href="/" className={styles.secondaryLink}>
          Bỏ qua, xem bản đồ ngay
        </Link>
        <Link href="/login" className={styles.textLink}>
          Đã có tài khoản? Đăng nhập
        </Link>
      </div>
    </div>
  );
}

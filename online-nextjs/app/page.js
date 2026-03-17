import fs from "fs";
import path from "path";
import Script from "next/script";

export default function HomePage() {
  const bodyHtml = fs.readFileSync(
    path.join(process.cwd(), "public", "youme-body.html"),
    "utf8"
  );

  return (
    <>
      <div dangerouslySetInnerHTML={{ __html: bodyHtml }} />
      <Script src="https://cdnjs.cloudflare.com/ajax/libs/cropperjs/1.5.13/cropper.min.js" strategy="afterInteractive" />
      <Script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js" strategy="afterInteractive" />
      <Script src="/youme.js" strategy="afterInteractive" />
    </>
  );
}

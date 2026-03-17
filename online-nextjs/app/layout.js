import "./globals.css";

export const metadata = {
  title: "YouMe Online",
  description: "Cloud-first YouMe build for Vercel (no YouTube download)",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Baloo+2:wght@400;500;600;700;800&family=Inter:wght@300;400;500;600;700&family=Montserrat:wght@400;500;600;700&family=Nunito:wght@400;600;700;800&family=Barlow+Condensed:wght@400;600;700&family=Orbitron:wght@400;600;700&family=Rajdhani:wght@500;600;700&display=swap"
        />
        <link
          rel="stylesheet"
          href="https://cdnjs.cloudflare.com/ajax/libs/cropperjs/1.5.13/cropper.min.css"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}

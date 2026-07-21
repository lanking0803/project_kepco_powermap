export const metadata = {
  title: "서비스 일시 중지",
};

export default function SuspendedPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm text-center">
        <h1 className="text-lg font-semibold text-gray-900">
          서비스 이용이 일시 중지되었습니다
        </h1>
        <p className="text-sm text-gray-500 mt-3">이용 기간이 만료되었습니다.</p>
      </div>
    </div>
  );
}

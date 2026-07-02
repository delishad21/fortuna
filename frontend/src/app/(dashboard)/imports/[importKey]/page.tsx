import { getImportDetail } from "@/app/actions/analytics";
import { ImportDetailClient } from "@/components/analytics/ImportDetailClient";

interface ImportDetailPageProps {
  params: Promise<{ importKey: string }>;
}

const safelyDecodeImportKey = (value: string) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

export default async function ImportDetailPage({ params }: ImportDetailPageProps) {
  const { importKey } = await params;
  const data = await getImportDetail(safelyDecodeImportKey(importKey));
  return <ImportDetailClient importDetail={data.import} />;
}

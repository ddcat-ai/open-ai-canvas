import PoseLibraryAdminPage from "./pose-library-page";

/** 后台「服装库」：与姿势库共用页面与接口，按 library=garment 区分数据。 */
export default function GarmentLibraryAdminPage() {
    return <PoseLibraryAdminPage library="garment" />;
}

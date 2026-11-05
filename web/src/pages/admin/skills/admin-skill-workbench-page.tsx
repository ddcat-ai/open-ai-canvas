import { useParams } from "react-router";

import { SkillWorkbench, type SkillWorkbenchApi } from "@/pages/skills/workbench";
import { adminSkillFileRawURL, getAdminSkill, getAdminSkillFile, listAdminSkillFiles, saveAdminSkillFiles, updateAdminSkillInfo } from "@/services/api/admin-skills";

const adminWorkbenchApi: SkillWorkbenchApi = {
    getSkill: getAdminSkill,
    listFiles: listAdminSkillFiles,
    getFile: getAdminSkillFile,
    saveFiles: saveAdminSkillFiles,
    rawURL: adminSkillFileRawURL,
};

const adminWorkbench = { saveInfo: updateAdminSkillInfo };

/** 后台技能工作台：与用户端同一编辑器，读写走管理员接口。 */
export default function AdminSkillWorkbenchPage() {
    const { skillId = "" } = useParams();
    return <SkillWorkbench skillId={skillId} api={adminWorkbenchApi} back={{ to: "/admin/skills", label: "技能管理" }} admin={adminWorkbench} />;
}

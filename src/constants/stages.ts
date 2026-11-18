/**
 * 播放形态清单（内置形态页）
 * 顺序与形态资源发行顺序一致：内置播放器的三个模式、504、519，其余按上架批次倒序。
 */
export interface PlayerStageItem {
  id: string;
  name: string;
  desc: string;
  /** 形态页文件名（相对 /player-stages/），内置播放器模式为 null */
  file: string | null;
  /** 内置播放器模式对应的播放器样式 */
  playerType?: "cover" | "record" | "fullscreen";
}

export const PLAYER_STAGES: PlayerStageItem[] = [
  {
    id: "classic-cover",
    name: "封面模式",
    desc: "大封面 + 歌词面板",
    file: null,
    playerType: "cover",
  },
  {
    id: "classic-record",
    name: "唱片模式",
    desc: "黑胶唱片 + 歌词面板",
    file: null,
    playerType: "record",
  },
  {
    id: "classic-fullscreen",
    name: "全屏封面",
    desc: "封面铺满 + 渐变过渡",
    file: null,
    playerType: "fullscreen",
  },
  {
    id: "504",
    name: "已发送",
    desc: "歌词是一条条正在打出来的消息",
    file: "504-imessage-lyric.html",
  },
  {
    id: "519",
    name: "琉璃幻境",
    desc: "极光流体着色器与水晶折射消散的梦境",
    file: "519-prism-euphoria.html",
  },
  {
    id: "666",
    name: "拼豆工坊",
    desc: "背景是专辑封面拼成的大幅拼豆钉板；每句歌词由漫天飞来的中空塑料小柱子落位拼出，唱完随机触发烘焙纸熨平定型或直接炸板散豆乱飞",
    file: "666-perler-beads.html",
  },
  {
    id: "665",
    name: "彩色刊报",
    desc: "现代彩色刊志铺在案头：专辑封面化作网点海报与专色配比，歌词分栏排进一期页码，非线性运镜俯冲游走，一页读尽便翻向下一版",
    file: "665-color-gazette.html",
  },
  {
    id: "664",
    name: "深渊标本",
    desc: "把歌曲封面当标本切开：纯黑白拼贴，切片在X光/负片/网点/线稿之间轮换，框、套准标记与浮尘压在整句歌词上",
    file: "664-deep-specimen.html",
  },
  {
    id: "570",
    name: "血月鸦群",
    desc: "巨型猩红血月剪影、枯枝荒原与3D惊飞黑鸦风暴",
    file: "570-blood-moon-crow.html",
  },
  {
    id: "581",
    name: "空间玻璃视窗",
    desc: "Apple Vision Pro式3D悬浮磨砂毛玻璃多层空间面板与流光折射",
    file: "581-glassmorphism-os-spatial.html",
  },
  {
    id: "620",
    name: "花火摩天轮",
    desc: "夏日祭夜空3D发光摩天轮剪影与万千物理轨迹烟花在镜头前连环绽放",
    file: "620-ferris-wheel-fireworks-night.html",
  },
  {
    id: "660",
    name: "镜潮",
    desc: "盐原尽头悬着一枚暗环，半环沉入水面靠倒影补全；歌词从水下逐字立起，倒影在潮线之下随波轻晃",
    file: "660-mirage.html",
  },
  {
    id: "663",
    name: "弹簧诗行",
    desc: "每字一条独立弹簧，逐字错帧破土回弹，五组空间构图随句轮换，字缘微光与液态高光条贴在壁纸引擎背景上运行",
    file: "663-spring-verse.html",
  },
  {
    id: "631",
    name: "星轨跟拍",
    desc: "镜头追着歌词，星空真实视差",
    file: "631-stellar-tracking.html",
  },
  {
    id: "629",
    name: "运动路径",
    desc: "黑字沿轨迹飞行，彩色线条乱穿",
    file: "629-motion-path.html",
  },
  { id: "628", name: "纸页快闪", desc: "一个词一页，整页纸跟着快切", file: "628-paper-flash.html" },
  {
    id: "627",
    name: "墨线暴走",
    desc: "红底白环剪纸，黑墨字每句换机位",
    file: "627-ink-line-rush.html",
  },
  {
    id: "621",
    name: "末日高架桥",
    desc: "废土斜阳下断裂的3D城市跨海高架桥、漫天蒲公英/辐射光尘与孤独剪影",
    file: "621-apocalyptic-sunset-overpass.html",
  },
  {
    id: "617",
    name: "水底教室",
    desc: "沉没在清澈深水中的青春教室课桌椅、丁达尔水波阳光与漂浮气泡",
    file: "617-underwater-classroom-sunbeam.html",
  },
  {
    id: "614",
    name: "非欧传送门",
    desc: "穿过悬浮3D画框直接看到并冲入完全不同色调与几何形态的平行空间",
    file: "614-non-euclidean-portal-rooms.html",
  },
  {
    id: "604",
    name: "百叶窗黑色电影",
    desc: "经典好莱坞黑色电影(Film Noir)百叶窗条纹阴影切割、烟雾缭绕与一抹惊艳主色",
    file: "604-monochrome-noir-rain-blind.html",
  },
  {
    id: "603",
    name: "折曲红绸",
    desc: "3D超现实雕塑感红色烤漆金属长带在极简暗黑空间中无限穿插",
    file: "603-folded-metal-ribbon-red.html",
  },
  {
    id: "590",
    name: "狂乱漫剪",
    desc: "顶级日漫MMV动态分镜拼贴、半调网点纸张撕裂与高速残影摇晃",
    file: "590-chainsaw-manga-collage.html",
  },
  {
    id: "588",
    name: "扳机社闪光帧",
    desc: "Trigger扳机社夸张广角透视、十字星爆发与黑白手绘冲击帧（Impact Frames）",
    file: "588-trigger-impact-frames.html",
  },
  {
    id: "582",
    name: "隧道远光灯",
    desc: "深夜无限混凝土公路隧道狂飙、顶部钠灯掠过与远光灯眩光",
    file: "582-concrete-tunnel-headlight.html",
  },
  {
    id: "580",
    name: "丝绒歌剧院",
    desc: "3D暗红丝绒舞台帷幕开合、追光灯柱与漫天金箔礼花",
    file: "580-red-velvet-theater-curtain.html",
  },
  {
    id: "572",
    name: "雷霆荆棘",
    desc: "3D带刺金属荆棘藤蔓缠绕与高压紫电击穿舞台",
    file: "572-barbed-wire-lightning.html",
  },
  {
    id: "571",
    name: "酸性液态镀铬",
    desc: "90年代Rave酸性流光纹理与扭曲液态银异形雕塑",
    file: "571-acid-techno-liquid-metal.html",
  },
  {
    id: "563",
    name: "体素街机厅",
    desc: "3D发光体素方块世界崩塌重组与16-Bit粒子爆炸",
    file: "563-pixel-arcade-voxel.html",
  },
  {
    id: "561",
    name: "波普网点分镜",
    desc: "蜘蛛侠平行宇宙式3D美漫分镜框、CMYK半调网点与拟声词炸裂",
    file: "561-halftone-comic-popart.html",
  },
  {
    id: "559",
    name: "落日合成器公路",
    desc: "80年代复古未来主义网格山脉、烈日切线与超跑狂飙",
    file: "559-synthwave-outrun-highway.html",
  },
  {
    id: "557",
    name: "千禧液态气球",
    desc: "Y2K充气镀铬金属泡泡字与酸性镭射贴纸空间",
    file: "557-y2k-chrome-inflatable.html",
  },
  {
    id: "552",
    name: "烟雨江南",
    desc: "乌篷船摇进无尽烟雨，词句落在前方水上",
    file: "552-ink-wash-rain-pavilion.html",
  },
  {
    id: "542",
    name: "雷暴云砧",
    desc: "穿梭万米高空积雨云峡谷与云内紫电闪击",
    file: "542-thunderhead-cumulonimbus.html",
  },
  {
    id: "540",
    name: "极地冰洞",
    desc: "3D万年蓝冰晶洞穴内壁折射与极光穿透",
    file: "540-aurora-ice-cavern.html",
  },
  {
    id: "525",
    name: "雨夜霓虹",
    desc: "车窗雨滴物理折射与都市霓虹散景的夜行舞台",
    file: "525-neon-raindrop.html",
  },
  {
    id: "524",
    name: "引力坍缩",
    desc: "黑洞引力透镜畸变与巨物空间运镜的史诗舞台",
    file: "524-monolith-void.html",
  },
  {
    id: "522",
    name: "深海回响",
    desc: "深海失重漂浮与水波折射光斑的沉浸舞台",
    file: "522-abyssal-echo.html",
  },
  {
    id: "521",
    name: "赛博挽歌",
    desc: "信号撕裂错位与3D网格俯冲的故障美学",
    file: "521-glitch-requiem.html",
  },
  {
    id: "520",
    name: "胶片慢门",
    desc: "王家卫式抽帧慢门残影与琥珀漏光胶片",
    file: "520-amber-shutter.html",
  },
  {
    id: "518",
    name: "瞬态撕裂",
    desc: "高速甩镜畸变与强拍色相爆闪的卡点舞台",
    file: "518-kinetic-whip.html",
  },
  {
    id: "517",
    name: "失焦记忆",
    desc: "3D纵深穿梭与RGB色差景深的情绪独白",
    file: "517-chromatic-pulse.html",
  },
  {
    id: "510",
    name: "积木字墙",
    desc: "歌词化作积木在三维空间砌成墙",
    file: "510-block-wall.html",
  },
  {
    id: "509",
    name: "活字蒙太奇",
    desc: "每个字都是一次镜头切换",
    file: "509-kinetic-montage.html?v=1",
  },
  {
    id: "508",
    name: "未来已来",
    desc: "克莱因蓝与铬字硬切，镜头跟着拍子走",
    file: "508-future-is-here.html",
  },
  {
    id: "506",
    name: "偏色过境",
    desc: "歌词从左边滑过，红蓝错位拖出景深",
    file: "506-chroma-pass.html?v=2",
  },
  {
    id: "505",
    name: "棱镜阈限",
    desc: "刚体棱镜切面，正反蒙版镂空歌词",
    file: "505-metalheart-prism.html",
  },
  { id: "443", name: "沉纱", desc: "水中真丝裹住闭目浮游的身体", file: "443-silk-cavern.html" },
  {
    id: "429",
    name: "晴日手记",
    desc: "斜阳晒着衣柜门上的拍立得与手写字",
    file: "429-sunlit-diary.html",
  },
  {
    id: "428",
    name: "热像监控",
    desc: "红外人形在监控噪点里逐字升温",
    file: "428-thermal-cctv.html",
  },
  {
    id: "413",
    name: "熔心棘冠",
    desc: "玻璃心脏在暗处融化，30 根钛棘围成冠",
    file: "413-thorn-glass-heart.html",
  },
  {
    id: "408",
    name: "音生晶簇",
    desc: "低音撑开晶格，鼓点催开光丝：三层自相似的分形晶体",
    file: "408-audio-crystal-bloom.html",
  },
  {
    id: "406",
    name: "冰隙微光",
    desc: "万年蓝冰的裂缝里，暖光随低频缓缓流过",
    file: "406-glacial-fissure.html",
  },
  {
    id: "398",
    name: "银球夜",
    desc: "镜球撒下满室十字星芒，歌词银白带霓虹辉光",
    file: "398-mirrorball-glitz.html",
  },
  {
    id: "396",
    name: "七寸留声",
    desc: "旧唱片店灯下的 45 转纸袖套与慢转黑胶",
    file: "396-crate-label.html",
  },
  {
    id: "383",
    name: "裂肉矩阵",
    desc: "被拉扯变形的人体网格在 300 拍下撕开，带建模手柄",
    file: "383-flesh-matrix.html",
  },
  {
    id: "370",
    name: "剪刀暴动",
    desc: "复印纸上的绑架信：愤怒被一个字一个字剪下来",
    file: "370-scissor-riot.html",
  },
  {
    id: "368",
    name: "图库事故",
    desc: "带水印的握手图库照压着银河脑，一起失控",
    file: "368-stock-meltdown.html",
  },
  {
    id: "366",
    name: "霓虹卡匣",
    desc: "低分辨率等距像素城，套在 16-bit 卡匣包装里",
    file: "366-neon-cartridge.html",
  },
  {
    id: "361",
    name: "载波残影",
    desc: "停播后的载波：SMPTE 测试卡隔着弧面玻璃，字幕仍在等一句回应",
    file: "361-dead-air-carrier.html",
  },
  {
    id: "359",
    name: "午夜访客",
    desc: "1999 年凌晨还亮着灯的个人主页，旋转铬骷髅与星空平铺",
    file: "359-midnight-visitor.html",
  },
  {
    id: "353",
    name: "酸柠反设计",
    desc: "满屏酸柠绿与系统默认字体：丑得诚实，字绝对清楚",
    file: "353-acid-lime.html",
  },
  {
    id: "339",
    name: "超扁平糖果",
    desc: "糖果粉柠檬黄的平面色块，糖果兽拖着条纹尾迹",
    file: "339-superflat-candy.html",
  },
  {
    id: "306",
    name: "靶心构成",
    desc: "包豪斯靶心出血：同心环带被声波撕开一道缺口",
    file: "306-bauhaus-target.html",
  },
  {
    id: "305",
    name: "钴蓝网格",
    desc: "瑞士网格与钴蓝单色纪实：封面做成印版，歌词排成账本",
    file: "305-cobalt-grid.html",
  },
  {
    id: "304",
    name: "童核",
    desc: "练习本内页：蜡笔小屋、笑脸太阳、背书包走远的人",
    file: "304-kidcore.html",
  },
  {
    id: "099",
    name: "生物荧光",
    desc: "荧光素在液体里扩散，字是一圈**正在扩散的荧光前沿**",
    file: "099-bioluma.html",
  },
  {
    id: "083",
    name: "霜花结晶",
    desc: "窗玻璃上的霜从字心向外结晶，字先出现再被霜盖住",
    file: "083-frost.html",
  },
  {
    id: "067",
    name: "电蚀刻痕",
    desc: "电极头沿笔画行进，电弧烧出熔坑，熔渣火花甩出；字是烧出来的槽，不是画上去的",
    file: "067-arc-etch.html",
  },
  {
    id: "066",
    name: "泼墨黏墙",
    desc: "词团从画外沿弧线砸上墙，黏住、墨点累积、逐字烧亮、换句被风扫走",
    file: "066-thrown-splat.html",
  },
  {
    id: "048",
    name: "谢尔宾斯基",
    desc: "镜头一直在往空洞里掉",
    file: "048-sierpinski-lyrics.html",
  },
  {
    id: "031",
    name: "CSS 立方体",
    desc: '字被"贴"在自转立方体的面上',
    file: "031-css-cube-lyrics.html",
  },
  {
    id: "027",
    name: "代码雨",
    desc: "雨不是背景，雨是光栅写入器",
    file: "027-code-rain-lyrics.html",
  },
  {
    id: "020",
    name: "网格地平线",
    desc: "字是一叠立在网格上的灯柱，被一道扫描前沿逐个点亮",
    file: "020-grid-horizon-lyrics.html",
  },
  {
    id: "012",
    name: "光行洞穴",
    desc: "每句词是一条在洞里向你飞来的弧面字带",
    file: "012-cave-lyrics.html",
  },
  {
    id: "010",
    name: "余烬",
    desc: "字是上升气流里的驻波，一直在被重建",
    file: "010-embers-lyrics.html",
  },
  {
    id: "008",
    name: "静雪",
    desc: "雪碰到笔画就粘住，唱完被横风吹散",
    file: "008-snow-lyrics.html",
  },
  {
    id: "002",
    name: "星际歌词",
    desc: "一路飞过去，一句一句穿过",
    file: "002-starfield-lyrics.html",
  },
  {
    id: "001",
    name: "粒子歌词",
    desc: "粒子在不同地方聚成词，镜头移过去",
    file: "001-particle-lyrics.html",
  },
];

/** 默认使用内置播放器的封面模式 */
export const DEFAULT_PLAYER_STAGE = "classic-cover";

/** 按 id 查找形态 */
export const findPlayerStage = (id: string) => PLAYER_STAGES.find((item) => item.id === id);

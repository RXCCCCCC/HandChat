/**
 * 成就徽章页面
 */

import { useState, useEffect } from "react";
import { useNavigate } from "react-router";
import { ArrowLeft, Award, Trophy, Zap, Heart, Target, Star, MessageCircle, Volume2, Hand } from "lucide-react";
import { Button } from "../components/ui/button";
import { userApi } from "../lib/api";

export default function AchievementsPage() {
  const navigate = useNavigate();
  const [totalAchievements, setTotalAchievements] = useState(0);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const data = await userApi.getStats();
        if (data.stats) setTotalAchievements(data.stats.achievements || 0);
      } catch (e) {
        console.warn("[成就页面] 获取数据失败(可能未登录):", e);
        setTotalAchievements(3);
      }
    };
    fetchStats();
  }, []);

  const achievements = [
    { title: "初识手语", desc: "完成第一次手语识别", icon: Hand, color: "text-blue-500", bg: "bg-blue-50", unlocked: true },
    { title: "交流达人", desc: "在社区发布10条动态", icon: MessageCircle, color: "text-pink-500", bg: "bg-pink-50", unlocked: totalAchievements >= 2 },
    { title: "坚持不懈", desc: "连续登录7天", icon: Target, color: "text-green-500", bg: "bg-green-50", unlocked: totalAchievements >= 3 },
    { title: "聆听者", desc: "使用声音检测功能50次", icon: Volume2, color: "text-indigo-500", bg: "bg-indigo-50", unlocked: totalAchievements >= 4 },
    { title: "社区明星", desc: "获得100个赞", icon: Star, color: "text-yellow-500", bg: "bg-yellow-50", unlocked: totalAchievements >= 5 },
    { title: "手语大师", desc: "完成所有基础课程", icon: Trophy, color: "text-purple-500", bg: "bg-purple-50", unlocked: totalAchievements >= 6 },
  ];

  const unlockedCount = achievements.filter(a => a.unlocked).length;

  return (
    <div className="min-h-screen pb-24" style={{ background: 'var(--app-background, #F2F2F7)' }}>
      <div className="bg-white/80 backdrop-blur-xl px-4 pt-14 pb-3 sticky top-0 z-50 flex items-center justify-center border-b border-black/5">
        <div className="w-full max-w-2xl flex items-center justify-center relative">
          <Button
            variant="ghost" size="sm" onClick={() => navigate(-1)}
            className="text-blue-500 hover:text-blue-600 hover:bg-transparent px-0 font-medium text-[17px] absolute left-0"
          >
            <ArrowLeft className="w-5 h-5 mr-1" />返回
          </Button>
          <h1 className="text-[17px] font-semibold text-black">我的成就</h1>
        </div>
      </div>

      <div className="p-4 space-y-3 w-full max-w-2xl mx-auto">
        {/* 汇总卡片 */}
        <div className="bg-gradient-to-br from-indigo-500 to-purple-600 rounded-[18px] p-5 text-white flex items-center justify-between shadow-md">
          <div>
            <p className="text-white/80 text-[13px] mb-0.5">已解锁成就</p>
            <div className="text-[28px] font-bold">{unlockedCount} <span className="text-[14px] font-normal opacity-80">/ {achievements.length}</span></div>
          </div>
          <Award className="w-14 h-14 text-white/20" />
        </div>

        {/* 成就列表 */}
        <div className="space-y-2">
          {achievements.map((item, idx) => {
            const Icon = item.icon;
            return (
              <div 
                key={idx} 
                className={`bg-white rounded-[14px] p-3.5 flex items-center gap-3 transition-all ${!item.unlocked ? 'opacity-50 grayscale' : 'shadow-sm'}`}
              >
                <div className={`w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0 ${item.bg} ${item.color}`}>
                  <Icon className="w-5 h-5" />
                </div>
                <div className="flex-1">
                  <h3 className="text-[15px] font-bold text-gray-900">{item.title}</h3>
                  <p className="text-[13px] text-gray-500 mt-0.5">{item.desc}</p>
                </div>
                {item.unlocked && (
                  <span className="text-[11px] font-medium text-indigo-500 bg-indigo-50 px-2 py-0.5 rounded-full">
                    已解锁
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
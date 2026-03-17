const notificationSound = new Audio('/sounds/notification.mp3')
notificationSound.volume = 0.5

const achievementSound = new Audio('/sounds/achievement.mp3')
achievementSound.volume = 0.6

const interventionSound = new Audio('/sounds/intervention.mp3')
interventionSound.volume = 0.6

export const playNotification = () => {
  notificationSound.currentTime = 0
  notificationSound.play().catch(() => {}) // Ignore autoplay errors
}

export const playAchievement = () => {
  achievementSound.currentTime = 0
  achievementSound.play().catch(() => {}) // Ignore autoplay errors
}

export const playIntervention = () => {
  interventionSound.currentTime = 0
  interventionSound.play().catch(() => {}) // Ignore autoplay errors
}

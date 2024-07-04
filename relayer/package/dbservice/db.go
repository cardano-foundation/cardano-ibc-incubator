package dbservice

import (
	"fmt"
	"github.com/cardano/relayer/v1/constant"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
	"log"
	"sync"
)

var Connections map[string]*gorm.DB
var once sync.Once

type DatabaseInfo struct {
	Name     string `json:"name"`
	Driver   string `json:"driver"`
	Username string `json:"username"`
	Password string `json:"password"`
	SSLMode  string `json:"ssl_mode"`
	Host     string `json:"host"`
	Port     string `json:"port"`
}

func ConnectToDb(cexplorer *DatabaseInfo) (err error) {
	once.Do(func() {
		Connections = make(map[string]*gorm.DB)
		dbSource := fmt.Sprintf("postgresql://%s:%s@%s:%s/%s?sslmode=%s",
			cexplorer.Username, cexplorer.Password, cexplorer.Host, cexplorer.Port, cexplorer.Name, cexplorer.SSLMode)
		Connections[constant.CardanoDB], err = gorm.Open(postgres.Open(dbSource), &gorm.Config{
			DisableNestedTransaction: false,
			Logger:                   logger.Default.LogMode(logger.Silent),
		})
		postgreDB, err := Connections[constant.CardanoDB].DB()
		if err != nil {
			log.Printf("Connect db-sync fail with error: %v", err.Error())
		}
		postgreDB.SetMaxIdleConns(20)
		postgreDB.SetMaxOpenConns(200)
	})
	return err
}
